import React, { useState, useCallback } from 'react';

type TableStatus = 'empty' | 'occupied' | 'waiting';

interface Table {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  status: TableStatus;
}

const FloorPlan: React.FC = () => {
  const [tables, setTables] = useState<Table[]>([
    { id: '1', x: 50, y: 50, width: 80, height: 80, status: 'empty' },
    { id: '2', x: 200, y: 50, width: 80, height: 80, status: 'occupied' },
    { id: '3', x: 350, y: 50, width: 80, height: 80, status: 'waiting' },
    { id: '4', x: 50, y: 200, width: 80, height: 80, status: 'empty' },
    { id: '5', x: 200, y: 200, width: 80, height: 80, status: 'occupied' },
  ]);

  const getColor = (status: TableStatus) => {
    switch (status) {
      case 'empty': return '#4caf50'; // green
      case 'occupied': return '#f44336'; // red
      case 'waiting': return '#ff9800'; // orange
      default: return '#9e9e9e';
    }
  };

  const handleDragStart = useCallback((e: React.DragEvent<HTMLDivElement>, id: string) => {
    e.dataTransfer.setData('text/plain', id);
    // optionally add a visual indicator
    e.currentTarget.style.opacity = '0.5';
  }, []);

  const handleDragEnd = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.currentTarget.style.opacity = '1';
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>, targetId: string) => {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData('text/plain');
    if (draggedId === '' || draggedId === targetId) return;

    setTables(prev => {
      const dragged = prev.find(t => t.id === draggedId);
      const target = prev.find(t => t.id === targetId);
      if (!dragged || !target) return prev;

      // If dropping onto another table, attempt to merge (simple: increase width)
      // For split, we could implement a separate action; here we just move.
      const newTables = prev.map(t => {
        if (t.id === draggedId) {
          // Move to target's position (simple snap)
          return { ...t, x: target.x, y: target.y };
        }
        return t;
      });
      return newTables;
    });
  }, []);

  const handleTableClick = useCallback((id: string) => {
    // Placeholder for merge/split logic via click (e.g., right-click menu could be added)
    setTables(prev =>
      prev.map(t =>
        t.id === id
          ? { ...t, status: t.status === 'empty' ? 'occupied' : t.status === 'occupied' ? 'waiting' : 'empty' }
          : t
      )
    );
  }, []);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '600px',
        backgroundColor: '#f5f5f5',
        border: '1px solid #ddd',
        overflow: 'hidden',
      }}
    >
      {tables.map(table => (
        <div
          key={table.id}
          id={`table-${table.id}`}
          draggable
          onDragStart={e => handleDragStart(e, table.id)}
          onDragEnd={handleDragEnd}
          onDragOver={handleDragOver}
          onDrop={e => handleDrop(e, table.id)}
          onClick={() => handleTableClick(table.id)}
          style={{
            position: 'absolute',
            left: table.x,
            top: table.y,
            width: table.width,
            height: table.height,
            backgroundColor: getColor(table.status),
            border: '2px solid #fff',
            borderRadius: '4px',
            cursor: 'grab',
            userSelect: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontWeight: 'bold',
            boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
            transition: 'transform 0.1s ease',
          }}
          onMouseDown={() => {
            // Change cursor while dragging
            const el = document.getElementById(`table-${table.id}`);
            if (el) el.style.cursor = 'grabbing';
          }}
          onMouseUp={() => {
            const el = document.getElementById(`table-${table.id}`);
            if (el) el.style.cursor = 'grab';
          }}
        >
          {table.id}
        </div>
      ))}
    </div>
  );
};

export default FloorPlan;