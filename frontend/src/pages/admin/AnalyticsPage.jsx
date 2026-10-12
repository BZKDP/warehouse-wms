import { LayoutGrid, FolderTree } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import InventoryAnalyticsView from './InventoryAnalyticsView';
import InventoryAnalyticsV2 from './InventoryAnalyticsV2';

export default function AnalyticsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const version = searchParams.get('v') || 'v2';
  const setVersion = (v) => setSearchParams({ v });

  return (
    <>
      {version === 'v1' ? (
        <div className="p-6 max-w-7xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Аналитика инвентаризации</h1>
              <p className="text-gray-500 text-sm mt-0.5">
                Последний инвент, прошлый инвент, участвовавшие коробки и зоны, которые давно не считались
              </p>
            </div>
            <VersionToggle version={version} setVersion={setVersion} />
          </div>
          <InventoryAnalyticsView />
        </div>
      ) : (
        <InventoryAnalyticsV2
          versionToggle={<VersionToggle version={version} setVersion={setVersion} />}
        />
      )}
    </>
  );
}

function VersionToggle({ version, setVersion }) {
  return (
    <div className="flex items-center bg-gray-50 rounded-2xl p-1.5 gap-1 flex-shrink-0 border border-gray-200">
      <button
        onClick={() => setVersion('v1')}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border ${
          version === 'v1' ? 'bg-blue-50 text-blue-700 border-blue-200 shadow-sm' : 'text-gray-400 hover:text-gray-600 border-transparent'
        }`}
      >
        <LayoutGrid size={13} />
        Карточки
      </button>
      <button
        onClick={() => setVersion('v2')}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border ${
          version === 'v2' ? 'bg-green-50 text-green-700 border-green-200 shadow-sm' : 'text-gray-400 hover:text-gray-600 border-transparent'
        }`}
      >
        <FolderTree size={13} />
        Дерево
      </button>
    </div>
  );
}
