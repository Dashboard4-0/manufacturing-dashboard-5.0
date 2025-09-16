import { useQuery } from '@apollo/client';
import { gql } from '@apollo/client';
import KPICard from '../components/KPICard';
import Chart from '../components/Chart';
import { useAppStore } from '../store/app.store';

const DASHBOARD_QUERY = gql`
  query GetDashboard($siteId: ID!) {
    site(id: $siteId) {
      id
      name
      metrics {
        oee
        availability
        performance
        quality
        safetyIncidents
        openActions
      }
      areas {
        id
        name
        lines {
          id
          name
          oee {
            oee
            availability
            performance
            quality
            timestamp
          }
        }
      }
    }
  }
`;

export default function Dashboard() {
  const { selectedSite } = useAppStore();
  const { data, loading, error } = useQuery(DASHBOARD_QUERY, {
    variables: { siteId: selectedSite },
    pollInterval: 60000, // Refresh every minute
  });

  if (loading) return <div className="flex justify-center items-center h-full">Loading...</div>;
  if (error) return <div className="text-red-500">Error: {error.message}</div>;

  const site = data?.site;
  const metrics = site?.metrics;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">{site?.name} Dashboard</h1>
        <div className="text-sm text-gray-500">
          Last updated: {new Date().toLocaleTimeString()}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <KPICard
          title="OEE"
          value={`${metrics?.oee?.toFixed(1)}%`}
          target={85}
          trend="up"
          color="blue"
        />
        <KPICard
          title="Availability"
          value={`${metrics?.availability?.toFixed(1)}%`}
          target={90}
          trend="stable"
          color="green"
        />
        <KPICard
          title="Performance"
          value={`${metrics?.performance?.toFixed(1)}%`}
          target={95}
          trend="up"
          color="yellow"
        />
        <KPICard
          title="Quality"
          value={`${metrics?.quality?.toFixed(1)}%`}
          target={99}
          trend="down"
          color="purple"
        />
        <KPICard
          title="Safety Incidents"
          value={metrics?.safetyIncidents || 0}
          target={0}
          trend="stable"
          color="red"
        />
        <KPICard
          title="Open Actions"
          value={metrics?.openActions || 0}
          target={10}
          trend="down"
          color="orange"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-xl font-semibold mb-4">OEE Trend - Last 24 Hours</h2>
          <Chart
            type="line"
            data={{
              labels: Array.from({ length: 24 }, (_, i) => `${i}:00`),
              datasets: [
                {
                  label: 'OEE',
                  data: Array.from({ length: 24 }, () => Math.random() * 20 + 70),
                  borderColor: 'rgb(59, 130, 246)',
                  backgroundColor: 'rgba(59, 130, 246, 0.1)',
                },
                {
                  label: 'Target',
                  data: Array(24).fill(85),
                  borderColor: 'rgb(239, 68, 68)',
                  borderDash: [5, 5],
                },
              ],
            }}
            options={{
              responsive: true,
              plugins: {
                legend: {
                  position: 'top' as const,
                },
                title: {
                  display: false,
                },
              },
              scales: {
                y: {
                  min: 0,
                  max: 100,
                },
              },
            }}
          />
        </div>

        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-xl font-semibold mb-4">Production Lines Status</h2>
          <div className="space-y-3">
            {site?.areas?.flatMap((area: any) =>
              area.lines.map((line: any) => (
                <div key={line.id} className="flex items-center justify-between p-3 bg-gray-50 rounded">
                  <div>
                    <div className="font-medium">{line.name}</div>
                    <div className="text-sm text-gray-500">{area.name}</div>
                  </div>
                  <div className="flex items-center space-x-4">
                    <div className="text-right">
                      <div className="text-2xl font-bold text-blue-600">
                        {line.oee?.oee?.toFixed(1)}%
                      </div>
                      <div className="text-xs text-gray-500">OEE</div>
                    </div>
                    <div className={`w-3 h-3 rounded-full ${
                      line.oee?.oee > 85 ? 'bg-green-500' :
                      line.oee?.oee > 65 ? 'bg-yellow-500' : 'bg-red-500'
                    }`} />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-xl font-semibold mb-4">Top Losses Today</h2>
          <div className="space-y-2">
            {['Equipment Failure', 'Changeover', 'Minor Stops', 'Speed Loss', 'Quality Defects'].map((loss, i) => (
              <div key={loss} className="flex justify-between items-center">
                <span className="text-sm">{loss}</span>
                <div className="flex items-center space-x-2">
                  <div className="w-24 bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-red-500 h-2 rounded-full"
                      style={{ width: `${100 - i * 20}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium w-12 text-right">{100 - i * 20}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-xl font-semibold mb-4">Active Andons</h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-red-50 border border-red-200 rounded">
              <div>
                <div className="font-medium text-red-900">Line 1 - Station 3</div>
                <div className="text-sm text-red-700">Quality Issue</div>
              </div>
              <div className="text-red-600 font-bold">2:45</div>
            </div>
            <div className="flex items-center justify-between p-3 bg-yellow-50 border border-yellow-200 rounded">
              <div>
                <div className="font-medium text-yellow-900">Line 2 - Station 1</div>
                <div className="text-sm text-yellow-700">Material Shortage</div>
              </div>
              <div className="text-yellow-600 font-bold">0:30</div>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-xl font-semibold mb-4">Upcoming Maintenance</h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-blue-50 rounded">
              <div>
                <div className="font-medium">Asset A1 - Bearing Replacement</div>
                <div className="text-sm text-gray-500">Tomorrow 08:00</div>
              </div>
              <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded">Planned</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-orange-50 rounded">
              <div>
                <div className="font-medium">Asset B2 - Oil Change</div>
                <div className="text-sm text-gray-500">In 2 days</div>
              </div>
              <span className="px-2 py-1 bg-orange-100 text-orange-800 text-xs rounded">Due Soon</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}