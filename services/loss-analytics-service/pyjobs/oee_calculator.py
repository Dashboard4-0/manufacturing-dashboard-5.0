#!/usr/bin/env python3
"""
OEE Calculator and Analytics Module
Provides advanced OEE calculations and loss analysis
"""

import os
import json
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Tuple, Optional
import numpy as np
import pandas as pd
from dataclasses import dataclass
import psycopg2
from psycopg2.extras import RealDictCursor
import redis

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@dataclass
class OEEMetrics:
    """OEE calculation results"""
    timestamp: datetime
    asset_id: str
    line_id: str
    oee: float
    availability: float
    performance: float
    quality: float
    runtime: float
    downtime: float
    total_count: int
    good_count: int
    reject_count: int

class OEECalculator:
    """Advanced OEE calculation and analysis"""

    def __init__(self):
        self.db_conn = self._get_db_connection()
        self.redis_client = redis.Redis(
            host=os.getenv('REDIS_HOST', 'localhost'),
            port=int(os.getenv('REDIS_PORT', 6379)),
            decode_responses=True
        )

    def _get_db_connection(self):
        """Create database connection"""
        return psycopg2.connect(
            host=os.getenv('TIMESCALE_HOST', 'localhost'),
            port=int(os.getenv('TIMESCALE_PORT', 5433)),
            database=os.getenv('TIMESCALE_DB', 'ms5_timeseries'),
            user=os.getenv('TIMESCALE_USER', 'ms5_ts'),
            password=os.getenv('TIMESCALE_PASSWORD', 'ms5_ts_dev_password')
        )

    def calculate_oee(
        self,
        asset_id: str,
        start_time: datetime,
        end_time: datetime
    ) -> OEEMetrics:
        """Calculate OEE for an asset over a time period"""

        with self.db_conn.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute("""
                SELECT
                    asset_id,
                    line_id,
                    SUM(runtime) as total_runtime,
                    SUM(downtime) as total_downtime,
                    SUM(good_count) as total_good,
                    SUM(reject_count) as total_reject,
                    AVG(temperature) as avg_temp,
                    AVG(vibration) as avg_vibration
                FROM telemetry
                WHERE asset_id = %s
                    AND timestamp >= %s
                    AND timestamp < %s
                GROUP BY asset_id, line_id
            """, (asset_id, start_time, end_time))

            data = cursor.fetchone()

            if not data:
                raise ValueError(f"No data found for asset {asset_id}")

            # Calculate time metrics
            planned_time = (end_time - start_time).total_seconds() / 60  # minutes
            runtime = data['total_runtime'] or 0
            downtime = data['total_downtime'] or 0

            # Calculate counts
            good_count = data['total_good'] or 0
            reject_count = data['total_reject'] or 0
            total_count = good_count + reject_count

            # OEE Components
            availability = (runtime / planned_time * 100) if planned_time > 0 else 0

            # Assume ideal cycle time from configuration
            ideal_cycle_time = self._get_ideal_cycle_time(asset_id)
            performance = ((total_count * ideal_cycle_time) / runtime * 100) if runtime > 0 else 0

            quality = (good_count / total_count * 100) if total_count > 0 else 0

            # Overall OEE
            oee = (availability * performance * quality) / 10000

            # Cap values at 100%
            availability = min(100, max(0, availability))
            performance = min(100, max(0, performance))
            quality = min(100, max(0, quality))
            oee = min(100, max(0, oee))

            return OEEMetrics(
                timestamp=datetime.now(),
                asset_id=asset_id,
                line_id=data['line_id'],
                oee=oee,
                availability=availability,
                performance=performance,
                quality=quality,
                runtime=runtime,
                downtime=downtime,
                total_count=total_count,
                good_count=good_count,
                reject_count=reject_count
            )

    def _get_ideal_cycle_time(self, asset_id: str) -> float:
        """Get ideal cycle time for asset from cache or config"""
        cache_key = f"ideal_cycle_time:{asset_id}"
        cached_value = self.redis_client.get(cache_key)

        if cached_value:
            return float(cached_value)

        # Default to 1 minute per unit, should be configured per asset
        ideal_time = 1.0
        self.redis_client.setex(cache_key, 3600, str(ideal_time))

        return ideal_time

    def analyze_losses(
        self,
        line_id: str,
        start_time: datetime,
        end_time: datetime
    ) -> Dict:
        """Perform comprehensive loss analysis"""

        with self.db_conn.cursor(cursor_factory=RealDictCursor) as cursor:
            # Get all losses for the period
            cursor.execute("""
                SELECT
                    category,
                    subcategory,
                    reason,
                    SUM(duration) as total_duration,
                    SUM(impact) as total_impact,
                    COUNT(*) as occurrences
                FROM losses
                WHERE line_id = %s
                    AND timestamp >= %s
                    AND timestamp < %s
                GROUP BY category, subcategory, reason
                ORDER BY total_duration DESC
            """, (line_id, start_time, end_time))

            losses = cursor.fetchall()

            if not losses:
                return {"message": "No losses found for the period"}

            # Perform Pareto analysis
            total_loss_time = sum(loss['total_duration'] for loss in losses)
            cumulative_percentage = 0
            pareto_losses = []

            for loss in losses:
                percentage = (loss['total_duration'] / total_loss_time * 100) if total_loss_time > 0 else 0
                cumulative_percentage += percentage

                pareto_losses.append({
                    'category': loss['category'],
                    'subcategory': loss['subcategory'],
                    'reason': loss['reason'],
                    'duration': loss['total_duration'],
                    'impact': loss['total_impact'],
                    'occurrences': loss['occurrences'],
                    'percentage': round(percentage, 2),
                    'cumulative_percentage': round(cumulative_percentage, 2)
                })

            # Identify top losses (80% rule)
            vital_few = []
            for loss in pareto_losses:
                vital_few.append(loss)
                if loss['cumulative_percentage'] >= 80:
                    break

            return {
                'period': {
                    'start': start_time.isoformat(),
                    'end': end_time.isoformat()
                },
                'total_loss_time': total_loss_time,
                'total_losses': len(losses),
                'pareto_analysis': pareto_losses,
                'vital_few': vital_few,
                'recommendations': self._generate_recommendations(vital_few)
            }

    def _generate_recommendations(self, vital_losses: List[Dict]) -> List[Dict]:
        """Generate improvement recommendations based on loss analysis"""
        recommendations = []

        for loss in vital_losses[:5]:  # Top 5 losses
            if loss['category'] == 'AVAILABILITY':
                if loss['subcategory'] == 'BREAKDOWN':
                    recommendations.append({
                        'area': 'Maintenance',
                        'priority': 'HIGH',
                        'action': f"Implement predictive maintenance for {loss['reason']}",
                        'expected_impact': f"Reduce downtime by {loss['percentage']/2:.1f}%"
                    })
                elif loss['subcategory'] == 'SETUP':
                    recommendations.append({
                        'area': 'Process',
                        'priority': 'MEDIUM',
                        'action': f"Apply SMED techniques to reduce {loss['reason']} time",
                        'expected_impact': f"Reduce setup time by 30-50%"
                    })

            elif loss['category'] == 'PERFORMANCE':
                if loss['subcategory'] == 'MINOR_STOPS':
                    recommendations.append({
                        'area': 'Automation',
                        'priority': 'MEDIUM',
                        'action': f"Automate or eliminate minor stops due to {loss['reason']}",
                        'expected_impact': f"Improve performance by {loss['percentage']/3:.1f}%"
                    })
                elif loss['subcategory'] == 'SPEED_LOSS':
                    recommendations.append({
                        'area': 'Optimization',
                        'priority': 'LOW',
                        'action': f"Optimize process parameters for {loss['reason']}",
                        'expected_impact': f"Increase speed by 10-15%"
                    })

            elif loss['category'] == 'QUALITY':
                recommendations.append({
                    'area': 'Quality Control',
                    'priority': 'HIGH',
                    'action': f"Implement SPC and root cause analysis for {loss['reason']}",
                    'expected_impact': f"Reduce defects by {loss['percentage']/2:.1f}%"
                })

        return recommendations

    def predict_oee_trend(
        self,
        line_id: str,
        days_history: int = 30,
        days_forecast: int = 7
    ) -> Dict:
        """Predict future OEE trend using simple linear regression"""

        end_date = datetime.now()
        start_date = end_date - timedelta(days=days_history)

        with self.db_conn.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute("""
                SELECT
                    DATE(timestamp) as date,
                    AVG(oee) as daily_oee
                FROM oee_calculations
                WHERE line_id = %s
                    AND timestamp >= %s
                    AND timestamp < %s
                GROUP BY DATE(timestamp)
                ORDER BY date
            """, (line_id, start_date, end_date))

            data = cursor.fetchall()

            if len(data) < 7:
                return {"error": "Insufficient data for trend analysis"}

            # Prepare data for regression
            df = pd.DataFrame(data)
            df['day_num'] = range(len(df))

            # Simple linear regression
            x = df['day_num'].values
            y = df['daily_oee'].values

            # Calculate slope and intercept
            n = len(x)
            x_mean = np.mean(x)
            y_mean = np.mean(y)

            numerator = np.sum((x - x_mean) * (y - y_mean))
            denominator = np.sum((x - x_mean) ** 2)

            slope = numerator / denominator if denominator != 0 else 0
            intercept = y_mean - slope * x_mean

            # Calculate R-squared
            y_pred = slope * x + intercept
            ss_res = np.sum((y - y_pred) ** 2)
            ss_tot = np.sum((y - y_mean) ** 2)
            r_squared = 1 - (ss_res / ss_tot) if ss_tot != 0 else 0

            # Generate forecast
            forecast_days = range(n, n + days_forecast)
            forecast_values = [slope * day + intercept for day in forecast_days]
            forecast_dates = [end_date + timedelta(days=i+1) for i in range(days_forecast)]

            # Determine trend
            if slope > 0.1:
                trend = "IMPROVING"
            elif slope < -0.1:
                trend = "DECLINING"
            else:
                trend = "STABLE"

            return {
                'historical_average': float(y_mean),
                'trend': trend,
                'trend_strength': float(r_squared),
                'daily_change': float(slope),
                'forecast': [
                    {
                        'date': date.isoformat(),
                        'predicted_oee': min(100, max(0, value))
                    }
                    for date, value in zip(forecast_dates, forecast_values)
                ]
            }

def main():
    """Main execution function"""
    calculator = OEECalculator()

    # Example: Calculate OEE for all assets
    try:
        # This would typically be called by the Node.js service
        # or run as a scheduled job
        logger.info("OEE Calculator ready")

    except Exception as e:
        logger.error(f"Error in OEE calculation: {e}")
        raise

if __name__ == "__main__":
    main()