import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { cn } from '../../utils/cn';

export default function SortTh({ label, sortKey, sort, onSort, className }) {
  const active = sort.key === sortKey;
  return (
    <th
      className={cn('cursor-pointer select-none group', className)}
      onClick={() => onSort(sortKey)}
    >
      <div className="flex items-center gap-1">
        <span>{label}</span>
        <span className={cn(
          'transition-opacity',
          active ? 'opacity-100 text-primary-500' : 'opacity-0 group-hover:opacity-50'
        )}>
          {active
            ? (sort.dir === 'asc'
              ? <ChevronUp size={13} />
              : <ChevronDown size={13} />)
            : <ChevronsUpDown size={13} />
          }
        </span>
      </div>
    </th>
  );
}
