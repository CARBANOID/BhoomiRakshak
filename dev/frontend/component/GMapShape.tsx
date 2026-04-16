import { useMap, useMapsLibrary } from '@vis.gl/react-google-maps';
import { useEffect, useState, useRef } from 'react';
import { Square, Circle, Pentagon, Pencil, Trash2, Move, X } from 'lucide-react';
import type { ShapeType , DrawnShape } from '@/config/types';
import { DrawShape } from '@/gmap/draw';


export function GMapShape() {
    const map = useMap('bhoomi-map');
    const drawing = useMapsLibrary('drawing');
    const [drawingManager, setDrawingManager] = useState<google.maps.drawing.DrawingManager | null>(null);
    const [activeShape, setActiveShape] = useState<ShapeType | null>(null);
    const [shapes, setShapes] = useState<DrawnShape[]>([]);
    const [selectedShape, setSelectedShape] = useState<string | null>(null);
    const [isOpen, setIsOpen] = useState(false);
    const shapeIdCounter = useRef(0);

    // Initialize Drawing Manager
    useEffect(() => {
        if (!map || !drawing) return;

        const manager = new drawing.DrawingManager({
            drawingMode: null,
            drawingControl: false,
            rectangleOptions: {
                fillColor: '#4285F4',
                fillOpacity: 0.3,
                strokeWeight: 2,
                strokeColor: '#4285F4',
                clickable: true,
                editable: false,
                draggable: true,
            },
            circleOptions: {
                fillColor: '#EA4335',
                fillOpacity: 0.3,
                strokeWeight: 2,
                strokeColor: '#EA4335',
                clickable: true,
                editable: false,
                draggable: true,
            },
            polygonOptions: {
                fillColor: '#34A853',
                fillOpacity: 0.3,
                strokeWeight: 2,
                strokeColor: '#34A853',
                clickable: true,
                editable: false,
                draggable: true,
            },
            polylineOptions: {
                strokeColor: '#FBBC04',
                strokeWeight: 3,
                clickable: true,
                editable: false,
                draggable: true,
            },
        });

        manager.setMap(map);
        setDrawingManager(manager);

        return () => {
            manager.setMap(null);
        };
    }, [map, drawing]);

    // Handle shape completion
    useEffect(() => {
        if (!drawingManager) return;

        const listeners = [
            google.maps.event.addListener(drawingManager, 'rectanglecomplete', (rectangle: google.maps.Rectangle) => {
                const id = `rectangle-${shapeIdCounter.current++}`;
                rectangle.setEditable(false);
                setShapes(prev => [...prev, { id, type: 'rectangle', shape: rectangle }]);
                drawingManager.setDrawingMode(null);
                setActiveShape(null);
                addShapeClickListener(id, rectangle);
            }),
            google.maps.event.addListener(drawingManager, 'circlecomplete', (circle: google.maps.Circle) => {
                const id = `circle-${shapeIdCounter.current++}`;
                circle.setEditable(false);
                setShapes(prev => [...prev, { id, type: 'circle', shape: circle }]);
                drawingManager.setDrawingMode(null);
                setActiveShape(null);
                addShapeClickListener(id, circle);
            }),
            google.maps.event.addListener(drawingManager, 'polygoncomplete', (polygon: google.maps.Polygon) => {
                const id = `polygon-${shapeIdCounter.current++}`;
                polygon.setEditable(false);
                setShapes(prev => [...prev, { id, type: 'polygon', shape: polygon }]);
                drawingManager.setDrawingMode(null);
                setActiveShape(null);
                addShapeClickListener(id, polygon);
            }),
            google.maps.event.addListener(drawingManager, 'polylinecomplete', (polyline: google.maps.Polyline) => {
                const id = `polyline-${shapeIdCounter.current++}`;
                polyline.setEditable(false) ;
                setShapes(prev => [...prev, { id, type: 'polyline', shape: polyline }]);
                drawingManager.setDrawingMode(null) ;
                setActiveShape(null) ;
                addShapeClickListener(id, polyline) ;
            }),
        ];

        return () => {
            listeners.forEach(listener => google.maps.event.removeListener(listener));
        };
    }, [drawingManager]);

    // Add click listener to shapes for selection
    const addShapeClickListener = (id: string, shape: google.maps.Rectangle | google.maps.Circle | google.maps.Polygon | google.maps.Polyline) => {
        google.maps.event.addListener(shape, 'click', () => {
            setSelectedShape(id);
        });
    };

    // Handle shape selection - make selected shape editable
    useEffect(() => {
        shapes.forEach(({ id, shape }) => {
            const isSelected = id === selectedShape;
            
            // Set editable based on selection
            if ('setEditable' in shape) {
                shape.setEditable(isSelected);
            }
            
            // Optional: Change appearance when selected
            if (shape instanceof google.maps.Rectangle || 
                shape instanceof google.maps.Circle || 
                shape instanceof google.maps.Polygon) {
                shape.setOptions({
                    strokeWeight: isSelected ? 3 : 2,
                    strokeOpacity: isSelected ? 1 : 0.8,
                });
            } else if (shape instanceof google.maps.Polyline) {
                shape.setOptions({
                    strokeWeight: isSelected ? 4 : 3,
                    strokeOpacity: isSelected ? 1 : 0.8,
                });
            }
        });
    }, [selectedShape, shapes]);

    // Handle keyboard delete
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.key === 'Delete' || e.key === 'Backspace') && selectedShape) {
                e.preventDefault();
                deleteShape(selectedShape);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedShape, shapes]);

    // Click outside to deselect
    useEffect(() => {
        if (!map) return;

        const listener = google.maps.event.addListener(map, 'click', () => {
            setSelectedShape(null);
        });

        return () => {
            google.maps.event.removeListener(listener);
        };
    }, [map]);

    const startDrawing = (shapeType: ShapeType) => {
        if (!drawingManager) return;

        const drawingModeMap = {
            rectangle: google.maps.drawing.OverlayType.RECTANGLE,
            circle: google.maps.drawing.OverlayType.CIRCLE,
            polygon: google.maps.drawing.OverlayType.POLYGON,
            polyline: google.maps.drawing.OverlayType.POLYLINE,
        };

        drawingManager.setDrawingMode(drawingModeMap[shapeType]);
        setActiveShape(shapeType);
    };

    const cancelDrawing = () => {
        if (!drawingManager) return;
        drawingManager.setDrawingMode(null);
        setActiveShape(null);
    };

    const deleteShape = (id: string | number) => {
        const shape = shapes.find(s => s.id === id);
        if (shape) {
            shape.shape.setMap(null);
            setShapes(prev => prev.filter(s => s.id !== id));
            setSelectedShape(null);
        }
    };

    const clearAllShapes = () => {
        shapes.forEach(shape => shape.shape.setMap(null));
        setShapes([]);
        setSelectedShape(null);
    };

    return (
        <>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`fixed left-4 bottom-8 z-[20] bg-white rounded-xl shadow-lg p-3 hover:shadow-xl transition-all duration-300 border-2 ${
                    isOpen ? 'border-blue-500' : 'border-gray-200'
                } group`}
            >
                <div className="relative">
                    <Square 
                        size={24} 
                        className={`transition-colors ${isOpen ? 'text-blue-600' : 'text-gray-700 group-hover:text-blue-600'}`}
                    />
                    {shapes.length > 0 && (
                        <span className="absolute -top-2 -right-2 bg-green-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                            {shapes.length}
                        </span>
                    )}
                </div>
            </button>

            {isOpen && (
                <div className="fixed left-4 bottom-24 z-[20] bg-white rounded-2xl shadow-2xl border border-gray-200 w-80">
                    <div className="flex flex-col">
                        {/* Header */}
                        <div className="p-4 border-b border-gray-200 bg-gradient-to-r from-purple-50 to-pink-50">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="bg-purple-600 p-2 rounded-lg">
                                        <Square className="text-white" size={18} />
                                    </div>
                                    <div>
                                        <h3 className="font-semibold text-gray-800 text-sm">Draw Shapes</h3>
                                        <p className="text-xs text-gray-600">{shapes.length} shape{shapes.length !== 1 ? 's' : ''}</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setIsOpen(false)}
                                    className="text-gray-500 hover:text-gray-700 p-1 hover:bg-white rounded-lg transition-colors"
                                >
                                    <X size={18} />
                                </button>
                            </div>
                        </div>

                        <div className="p-4 space-y-3">
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    onClick={() => startDrawing('rectangle')}
                                    disabled={activeShape !== null}
                                    className={`flex items-center gap-2 p-3 rounded-lg border-2 transition-all ${
                                        activeShape === 'rectangle'
                                            ? 'bg-blue-50 border-blue-500 text-blue-700'
                                            : 'bg-white border-gray-200 hover:border-blue-300 text-gray-700'
                                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                                >
                                    <Square size={18} />
                                    <span className="text-sm font-medium">Rectangle</span>
                                </button>

                                <button
                                    onClick={() => startDrawing('circle')}
                                    disabled={activeShape !== null}
                                    className={`flex items-center gap-2 p-3 rounded-lg border-2 transition-all ${
                                        activeShape === 'circle'
                                            ? 'bg-red-50 border-red-500 text-red-700'
                                            : 'bg-white border-gray-200 hover:border-red-300 text-gray-700'
                                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                                >
                                    <Circle size={18} />
                                    <span className="text-sm font-medium">Circle</span>
                                </button>

                                <button
                                    onClick={() => startDrawing('polygon')}
                                    disabled={activeShape !== null}
                                    className={`flex items-center gap-2 p-3 rounded-lg border-2 transition-all ${
                                        activeShape === 'polygon'
                                            ? 'bg-green-50 border-green-500 text-green-700'
                                            : 'bg-white border-gray-200 hover:border-green-300 text-gray-700'
                                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                                >
                                    <Pentagon size={18} />
                                    <span className="text-sm font-medium">Polygon</span>
                                </button>

                                <button
                                    onClick={() => startDrawing('polyline')}
                                    disabled={activeShape !== null}
                                    className={`flex items-center gap-2 p-3 rounded-lg border-2 transition-all ${
                                        activeShape === 'polyline'
                                            ? 'bg-yellow-50 border-yellow-500 text-yellow-700'
                                            : 'bg-white border-gray-200 hover:border-yellow-300 text-gray-700'
                                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                                >
                                    <Pencil size={18} />
                                    <span className="text-sm font-medium">Line</span>
                                </button>
                            </div>

                            {activeShape && (
                                <button
                                    onClick={cancelDrawing}
                                    className="w-full p-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors text-sm font-medium"
                                >
                                    Cancel Drawing
                                </button>
                            )}

                            {activeShape && (
                                <div className="bg-blue-50 p-3 rounded-lg">
                                    <p className="text-xs text-blue-700 leading-relaxed">
                                        <strong>Tip:</strong> {activeShape === 'polygon' || activeShape === 'polyline' 
                                            ? 'Click on the map to add points. Double-click to finish.' 
                                            : 'Click and drag on the map to draw.'}
                                    </p>
                                </div>
                            )}

                            {selectedShape && (
                                <div className="bg-red-50 p-3 rounded-lg">
                                    <p className="text-xs text-red-700 leading-relaxed">
                                        <strong>Selected:</strong> Press <kbd className="px-1.5 py-0.5 bg-white rounded border border-red-200">Delete</kbd> or <kbd className="px-1.5 py-0.5 bg-white rounded border border-red-200">Backspace</kbd> to remove
                                    </p>
                                </div>
                            )}
                        </div>

                        {shapes.length > 0 && (
                            <div className="border-t border-gray-200">
                                <div className="p-4 space-y-2">
                                    <div className="flex items-center justify-between mb-2">
                                        <h4 className="text-sm font-semibold text-gray-700">Drawn Shapes</h4>
                                        <button
                                            onClick={clearAllShapes}
                                            className="text-xs text-red-600 hover:text-red-700 font-medium"
                                        >
                                            Clear All
                                        </button>
                                    </div>
                                    <div className="space-y-2 max-h-40 overflow-y-auto">
                                        {shapes.map((shape) => (
                                            <div
                                                key={shape.id}
                                                className={`flex items-center justify-between p-2 rounded-lg transition-colors ${
                                                    selectedShape === shape.id 
                                                        ? 'bg-blue-100 border-2 border-blue-400' 
                                                        : 'bg-gray-50 hover:bg-gray-100 border-2 border-transparent'
                                                }`}
                                            >
                                                <div className="flex items-center gap-2">
                                                    {shape.type === 'rectangle' && <Square size={16} className="text-blue-600" />}
                                                    {shape.type === 'circle' && <Circle size={16} className="text-red-600" />}
                                                    {shape.type === 'polygon' && <Pentagon size={16} className="text-green-600" />}
                                                    {shape.type === 'polyline' && <Pencil size={16} className="text-yellow-600" />}
                                                    <span className="text-sm text-gray-700 capitalize">{shape.type}</span>
                                                </div>
                                                <button
                                                    onClick={() => deleteShape(shape.id)}
                                                    className="p-1 hover:bg-red-100 rounded text-red-600 transition-colors"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}

                        {shapes.length === 0 && !activeShape && (
                            <div className="p-4 border-t border-gray-200">
                                <div className="flex items-start gap-2 bg-purple-50 p-3 rounded-lg">
                                    <Move size={16} className="text-purple-600 flex-shrink-0 mt-0.5" />
                                    <p className="text-xs text-purple-700 leading-relaxed">
                                        All shapes are editable and draggable. Click to select, press Delete to remove.
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </>
    );
}