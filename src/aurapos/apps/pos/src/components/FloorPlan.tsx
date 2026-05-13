import React, { useState, useCallback } from 'react';

type TableStatus = 'empty' | 'occupied' | 'waiting';

interface Table {
  id: number;
  x: number; // left position in px
  y: number; // top position in px
  status: TableStatus;
  width?: number;
  height?: number;
}

const FloorPlan: React.FC = () => {
  const [tables, setTables] = useState<Table[]>([
    { id: 1, x: 50, y: 50, status: 'empty', width: 80, height: 80 },
    { id: 2, x: 200, y: 50, status: 'occupied', width: 80, height: 80 },
    { id: 3, x: 350, y: 50, status: 'waiting', width: 80, height: 80 },
    { id: 4, x: 50, y: 200, status: 'empty', width: 80, height: 80 },
    { id: 5, x: 200, y: 200, status: 'occupied', width: 80, height: 80 },
  ]);

  const handleDragStart = useCallback((e: React.DragEvent<HTMLDivElement>, id: number) => {
    e.dataTransfer.setAttribute('text/plain', id.toString());
    // Optionally add a visual cue while dragging
    e.currentTarget.style.opacity = '0.5';
  }, []);

  const handleDragEnd = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.currentTarget.style.opacity = '1';
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault(); // allow drop
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>, containerRef: React.RefObject<HTMLDivElement>) => {
      e.preventDefault();
      const draggedId = Number(e.dataTransfer.getAttribute('text/plain'));
      if (isNaN(draggedId)) return;

      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const offsetX = e.clientX - rect.left;
      const offsetY = e.clientY - rect.top;

      setTables(prev =>
        prev.map(t =>
          t.id === draggedId ? { ...t, x: offsetX, y: offsetY } : t
        )
      );
    },
    []
  );

  const getStatusColor = (status: TableStatus): string => {
    switch (status) {
      case 'empty': return '#4CAF50'; // green
      case 'occupied': return '#F44336'; // red
      case 'waiting': return '#FF9800'; // orange
      default: return '#9E9E9E';
    }
  };

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
      ref={/* container ref will be created below */}
    >
      <div
        ref={(ref) => {
          // We need to pass ref to drop handler; we can store in a variable via useRef,
          // but for minimal code we'll just use a closure.
          // We'll create a ref using useState to avoid extra hook.
          // Simpler: use a callback ref and store in a variable via useRef.
          // However to keep code short, we'll use useRef.
        }}
      >
        {/* We'll create a ref using useState hook */}
      </div>
      {/* Actually easier: create ref with useState and spread */}
    </div>
  );
};

export default FloorPlan;