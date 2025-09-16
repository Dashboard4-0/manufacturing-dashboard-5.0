#!/usr/bin/env python3
"""
Anomaly Detection Module for OEE and Asset Performance
Uses statistical methods to detect anomalies in production metrics
"""

import os
import json
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Tuple, Optional
import numpy as np
import pandas as pd
from scipy import stats
from dataclasses import dataclass
import psycopg2
from psycopg2.extras import RealDictCursor

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@dataclass
class Anomaly:
    """Detected anomaly information"""
    timestamp: datetime
    asset_id: str
    metric: str
    value: float
    expected_value: float
    deviation: float
    severity: str  # LOW, MEDIUM, HIGH, CRITICAL
    confidence: float
    description: str

class AnomalyDetector:
    """Statistical anomaly detection for manufacturing metrics"""

    def __init__(self):
        self.db_conn = self._get_db_connection()
        self.z_threshold = {
            'LOW': 2.0,
            'MEDIUM': 2.5,
            'HIGH': 3.0,
            'CRITICAL': 3.5
        }

    def _get_db_connection(self):
        """Create database connection"""
        return psycopg2.connect(
            host=os.getenv('TIMESCALE_HOST', 'localhost'),
            port=int(os.getenv('TIMESCALE_PORT', 5433)),
            database=os.getenv('TIMESCALE_DB', 'ms5_timeseries'),
            user=os.getenv('TIMESCALE_USER', 'ms5_ts'),
            password=os.getenv('TIMESCALE_PASSWORD', 'ms5_ts_dev_password')
        )

    def detect_oee_anomalies(
        self,
        line_id: str,
        window_hours: int = 24,
        lookback_days: int = 30
    ) -> List[Anomaly]:
        """Detect anomalies in OEE metrics using statistical methods"""

        current_time = datetime.now()
        window_start = current_time - timedelta(hours=window_hours)
        historical_start = current_time - timedelta(days=lookback_days)

        anomalies = []

        with self.db_conn.cursor(cursor_factory=RealDictCursor) as cursor:
            # Get recent data
            cursor.execute("""
                SELECT
                    asset_id,
                    timestamp,
                    oee,
                    availability,
                    performance,
                    quality
                FROM oee_calculations
                WHERE line_id = %s
                    AND timestamp >= %s
                    AND timestamp < %s
                ORDER BY timestamp
            """, (line_id, window_start, current_time))

            recent_data = cursor.fetchall()

            # Get historical data for baseline
            cursor.execute("""
                SELECT
                    asset_id,
                    AVG(oee) as avg_oee,
                    STDDEV(oee) as std_oee,
                    AVG(availability) as avg_availability,
                    STDDEV(availability) as std_availability,
                    AVG(performance) as avg_performance,
                    STDDEV(performance) as std_performance,
                    AVG(quality) as avg_quality,
                    STDDEV(quality) as std_quality
                FROM oee_calculations
                WHERE line_id = %s
                    AND timestamp >= %s
                    AND timestamp < %s
                GROUP BY asset_id
            """, (line_id, historical_start, window_start))

            baselines = {row['asset_id']: row for row in cursor.fetchall()}

            # Check each recent data point
            for data_point in recent_data:
                asset_id = data_point['asset_id']
                if asset_id not in baselines:
                    continue

                baseline = baselines[asset_id]

                # Check OEE
                oee_anomaly = self._check_anomaly(
                    data_point['oee'],
                    baseline['avg_oee'],
                    baseline['std_oee'],
                    'OEE',
                    data_point['timestamp'],
                    asset_id
                )
                if oee_anomaly:
                    anomalies.append(oee_anomaly)

                # Check Availability
                avail_anomaly = self._check_anomaly(
                    data_point['availability'],
                    baseline['avg_availability'],
                    baseline['std_availability'],
                    'Availability',
                    data_point['timestamp'],
                    asset_id
                )
                if avail_anomaly:
                    anomalies.append(avail_anomaly)

                # Check Performance
                perf_anomaly = self._check_anomaly(
                    data_point['performance'],
                    baseline['avg_performance'],
                    baseline['std_performance'],
                    'Performance',
                    data_point['timestamp'],
                    asset_id
                )
                if perf_anomaly:
                    anomalies.append(perf_anomaly)

                # Check Quality
                qual_anomaly = self._check_anomaly(
                    data_point['quality'],
                    baseline['avg_quality'],
                    baseline['std_quality'],
                    'Quality',
                    data_point['timestamp'],
                    asset_id
                )
                if qual_anomaly:
                    anomalies.append(qual_anomaly)

        return anomalies

    def _check_anomaly(
        self,
        value: float,
        mean: float,
        std: float,
        metric: str,
        timestamp: datetime,
        asset_id: str
    ) -> Optional[Anomaly]:
        """Check if a value is anomalous using z-score"""

        if std == 0 or std is None:
            return None

        z_score = abs((value - mean) / std)

        # Determine severity
        severity = None
        for level, threshold in sorted(self.z_threshold.items(), key=lambda x: x[1], reverse=True):
            if z_score >= threshold:
                severity = level
                break

        if not severity:
            return None

        # Calculate confidence based on z-score
        confidence = min(99.9, stats.norm.cdf(z_score) * 100)

        # Generate description
        direction = "below" if value < mean else "above"
        description = f"{metric} is {abs(value - mean):.1f} points {direction} normal ({mean:.1f})"

        return Anomaly(
            timestamp=timestamp,
            asset_id=asset_id,
            metric=metric,
            value=value,
            expected_value=mean,
            deviation=z_score,
            severity=severity,
            confidence=confidence,
            description=description
        )

    def detect_pattern_anomalies(
        self,
        asset_id: str,
        window_hours: int = 24
    ) -> List[Dict]:
        """Detect pattern-based anomalies (trends, cycles, sudden changes)"""

        end_time = datetime.now()
        start_time = end_time - timedelta(hours=window_hours)

        with self.db_conn.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute("""
                SELECT
                    timestamp,
                    oee,
                    runtime,
                    downtime,
                    good_count,
                    reject_count
                FROM telemetry
                WHERE asset_id = %s
                    AND timestamp >= %s
                    AND timestamp < %s
                ORDER BY timestamp
            """, (asset_id, start_time, end_time))

            data = pd.DataFrame(cursor.fetchall())

            if data.empty or len(data) < 10:
                return []

            patterns = []

            # Detect sudden drops in OEE
            oee_diff = data['oee'].diff()
            sudden_drops = data[oee_diff < -20]  # More than 20% drop

            for _, row in sudden_drops.iterrows():
                patterns.append({
                    'type': 'SUDDEN_DROP',
                    'metric': 'OEE',
                    'timestamp': row['timestamp'].isoformat(),
                    'value': row['oee'],
                    'severity': 'HIGH',
                    'description': f"Sudden OEE drop detected at {row['timestamp']}"
                })

            # Detect increasing reject rate trend
            if len(data) >= 20:
                recent_rejects = data['reject_count'].tail(10).mean()
                historical_rejects = data['reject_count'].head(10).mean()

                if recent_rejects > historical_rejects * 1.5:  # 50% increase
                    patterns.append({
                        'type': 'TREND',
                        'metric': 'Quality',
                        'timestamp': end_time.isoformat(),
                        'severity': 'MEDIUM',
                        'description': f"Increasing reject rate trend detected"
                    })

            # Detect excessive downtime periods
            high_downtime = data[data['downtime'] > data['runtime'] * 0.3]  # Downtime > 30% of runtime

            for _, row in high_downtime.iterrows():
                patterns.append({
                    'type': 'THRESHOLD_BREACH',
                    'metric': 'Downtime',
                    'timestamp': row['timestamp'].isoformat(),
                    'value': row['downtime'],
                    'severity': 'HIGH',
                    'description': f"Excessive downtime at {row['timestamp']}"
                })

            return patterns

    def detect_multivariate_anomalies(
        self,
        line_id: str,
        window_hours: int = 24
    ) -> List[Dict]:
        """Detect anomalies using multivariate analysis (Mahalanobis distance)"""

        end_time = datetime.now()
        start_time = end_time - timedelta(hours=window_hours)

        with self.db_conn.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute("""
                SELECT
                    timestamp,
                    asset_id,
                    oee,
                    temperature,
                    pressure,
                    vibration,
                    current
                FROM telemetry
                WHERE line_id = %s
                    AND timestamp >= %s
                    AND timestamp < %s
                    AND temperature IS NOT NULL
                    AND pressure IS NOT NULL
                    AND vibration IS NOT NULL
                ORDER BY timestamp
            """, (line_id, start_time, end_time))

            data = pd.DataFrame(cursor.fetchall())

            if data.empty or len(data) < 30:
                return []

            # Select numerical features
            features = ['oee', 'temperature', 'pressure', 'vibration', 'current']
            X = data[features].fillna(data[features].mean())

            # Calculate Mahalanobis distance
            mean = X.mean()
            cov_matrix = X.cov()

            try:
                inv_cov = np.linalg.pinv(cov_matrix)
            except:
                return []

            anomalies = []

            for idx, row in data.iterrows():
                x = X.iloc[idx].values
                diff = x - mean.values
                m_distance = np.sqrt(diff.T @ inv_cov @ diff)

                # Threshold based on chi-square distribution
                # For 5 features, 99% confidence ~ 15.09
                if m_distance > 15.09:
                    anomalies.append({
                        'timestamp': row['timestamp'].isoformat(),
                        'asset_id': row['asset_id'],
                        'type': 'MULTIVARIATE',
                        'distance': float(m_distance),
                        'severity': 'HIGH' if m_distance > 20 else 'MEDIUM',
                        'description': f"Multiple parameters showing unusual combination",
                        'parameters': {
                            'oee': row['oee'],
                            'temperature': row['temperature'],
                            'pressure': row['pressure'],
                            'vibration': row['vibration']
                        }
                    })

            return anomalies

    def generate_alerts(self, anomalies: List[Anomaly]) -> List[Dict]:
        """Generate actionable alerts from detected anomalies"""

        alerts = []

        # Group anomalies by asset and severity
        from collections import defaultdict
        grouped = defaultdict(list)

        for anomaly in anomalies:
            key = (anomaly.asset_id, anomaly.severity)
            grouped[key].append(anomaly)

        for (asset_id, severity), group in grouped.items():
            if len(group) >= 3:  # Multiple anomalies for same asset
                alerts.append({
                    'asset_id': asset_id,
                    'severity': severity,
                    'type': 'MULTIPLE_ANOMALIES',
                    'count': len(group),
                    'metrics': list(set(a.metric for a in group)),
                    'action': 'Immediate investigation required',
                    'timestamp': max(a.timestamp for a in group).isoformat()
                })
            elif severity in ['HIGH', 'CRITICAL']:
                for anomaly in group:
                    alerts.append({
                        'asset_id': asset_id,
                        'severity': severity,
                        'type': 'SINGLE_ANOMALY',
                        'metric': anomaly.metric,
                        'value': anomaly.value,
                        'expected': anomaly.expected_value,
                        'action': self._get_recommended_action(anomaly),
                        'timestamp': anomaly.timestamp.isoformat()
                    })

        return sorted(alerts, key=lambda x: x['severity'], reverse=True)

    def _get_recommended_action(self, anomaly: Anomaly) -> str:
        """Get recommended action based on anomaly type"""

        actions = {
            'OEE': {
                'HIGH': 'Check production line immediately',
                'CRITICAL': 'Stop production and investigate'
            },
            'Availability': {
                'HIGH': 'Check for equipment failures',
                'CRITICAL': 'Initiate maintenance protocol'
            },
            'Performance': {
                'HIGH': 'Review cycle times and minor stops',
                'CRITICAL': 'Check for major speed losses'
            },
            'Quality': {
                'HIGH': 'Increase quality inspections',
                'CRITICAL': 'Quarantine recent production'
            }
        }

        return actions.get(anomaly.metric, {}).get(
            anomaly.severity,
            'Monitor situation closely'
        )

def main():
    """Main execution function"""
    detector = AnomalyDetector()

    try:
        # This would typically be called by the Node.js service
        logger.info("Anomaly Detector ready")

    except Exception as e:
        logger.error(f"Error in anomaly detection: {e}")
        raise

if __name__ == "__main__":
    main()