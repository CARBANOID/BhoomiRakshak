import { useMap, useMapsLibrary } from '@vis.gl/react-google-maps';
import { useEffect, useState, useRef } from 'react';
import { Square, Circle, Pentagon, Pencil, Trash2, X, RefreshCw, Map as MapIcon } from 'lucide-react';
import type { AoiDrawType , PendingAoi } from '@/config/types';
import { backendUrl } from '@/config/backendUrl';

type AoiGeometry = {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: number[][][] | number[][][][];
};

type AoiSourceType = 'rectangle' | 'circle' | 'polygon' | 'bbox';

type ConvertedAoi = {
    geometry: AoiGeometry;
    sourceType: AoiSourceType;
    metadata?: Record<string, string | number | boolean>;
};

type GMapAOIProps = {
    onAoiCreated?: (aoiId: string) => void;
};

function clamp(val: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, val));
}

function normalizeCoords(points: number[][]): number[][] {
    return points.map(([lng, lat]) => [
        Number(clamp(lng, -180, 180).toFixed(8)),
        Number(clamp(lat, -90, 90).toFixed(8))
    ]);
}

function closeRing(points: number[][]): number[][] {
    if (points.length === 0) return points;
    const normalized = normalizeCoords(points);
    const first = normalized[0];
    const last = normalized[normalized.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) return normalized;
    return [...normalized, first];
}

function rectangleToGeometry(rectangle: google.maps.Rectangle): ConvertedAoi {
    const bounds = rectangle.getBounds();
    if (!bounds) throw new Error('Rectangle bounds are unavailable.');
    const north = bounds.getNorthEast().lat();
    const east = bounds.getNorthEast().lng();
    const south = bounds.getSouthWest().lat();
    const west = bounds.getSouthWest().lng();
    const ring = closeRing([[west, south], [east, south], [east, north], [west, north]]);
    return { geometry: { type: 'Polygon', coordinates: [ring] }, sourceType: 'rectangle' };
}

function polygonToGeometry(polygon: google.maps.Polygon): ConvertedAoi {
    const path = polygon.getPath();
    const points = path.getArray().map((latLng) => [latLng.lng(), latLng.lat()]);
    if (points.length < 3) throw new Error('Polygon needs at least 3 points.');
    const ring = closeRing(points);
    return { geometry: { type: 'Polygon', coordinates: [ring] }, sourceType: 'polygon' };
}

function circleToGeometry(circle: google.maps.Circle, segments = 48): ConvertedAoi {
    const center = circle.getCenter();
    if (!center) throw new Error('Circle center is unavailable.');
    const radiusMeters = circle.getRadius();
    const earthRadiusMeters = 6_378_137;
    const angularDistance = radiusMeters / earthRadiusMeters;
    const latRad = (center.lat() * Math.PI) / 180;
    const lngRad = (center.lng() * Math.PI) / 180;
    const sinLat = Math.sin(latRad);
    const cosLat = Math.cos(latRad);
    const sinAd = Math.sin(angularDistance);
    const cosAd = Math.cos(angularDistance);

    const ring: number[][] = [];
    for (let i = 0; i < segments; i += 1) {
        const theta = (2 * Math.PI * i) / segments;
        const sinTheta = Math.sin(theta);
        const cosTheta = Math.cos(theta);
        const pointLat = Math.asin(sinLat * cosAd + cosLat * sinAd * cosTheta);
        const pointLng = lngRad + Math.atan2(sinTheta * sinAd * cosLat, cosAd - sinLat * Math.sin(pointLat));
        ring.push([(pointLng * 180) / Math.PI, (pointLat * 180) / Math.PI]);
    }
    return {
        geometry: { type: 'Polygon', coordinates: [closeRing(ring)] },
        sourceType: 'circle',
        metadata: { radiusMeters: Math.round(radiusMeters), center: { lat: center.lat(), lng: center.lng() } }
    };
}

function polylineToBboxGeometry(polyline: google.maps.Polyline): ConvertedAoi {
    const path = polyline.getPath().getArray();
    if (path.length < 2) throw new Error('Polyline needs at least 2 points.');
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    path.forEach((latLng) => {
        minLat = Math.min(minLat, latLng.lat());
        maxLat = Math.max(maxLat, latLng.lat());
        minLng = Math.min(minLng, latLng.lng());
        maxLng = Math.max(maxLng, latLng.lng());
    });
    const ring = closeRing([[minLng, minLat], [maxLng, minLat], [maxLng, maxLat], [minLng, maxLat]]);
    return {
        geometry: { type: 'Polygon', coordinates: [ring] },
        sourceType: 'bbox',
        metadata: { originalShapeType: 'polyline', polylinePoints: path.length }
    };
}

function convertDrawingToAoi(pendingAoi: PendingAoi): ConvertedAoi {
    if (pendingAoi.type === 'marker' && pendingAoi.shape instanceof google.maps.Marker) {
        const pos = pendingAoi.shape.getPosition();
        if (!pos) throw new Error('Marker has no position');
        return {
            geometry: {
                type: 'Polygon',
                coordinates: [closeRing(Array.from({length: 32}, (_, i) => {
                    const angle = (i / 32) * 2 * Math.PI;
                    const lat = pos.lat() + (10 / 111320) * Math.cos(angle);
                    const lng = pos.lng() + (10 / (111320 * Math.cos(pos.lat() * Math.PI / 180))) * Math.sin(angle);
                    return [lng, lat];
                }))]
            },
            sourceType: 'circle',
            metadata: { center: { lat: pos.lat(), lng: pos.lng() }, radiusMeters: 10, isPoint: true }
        };
    }
    if (pendingAoi.shape instanceof google.maps.Polygon) return polygonToGeometry(pendingAoi.shape);
    if (pendingAoi.type === 'rectangle' && pendingAoi.shape instanceof google.maps.Rectangle) return rectangleToGeometry(pendingAoi.shape);
    if (pendingAoi.type === 'circle' && pendingAoi.shape instanceof google.maps.Circle) return circleToGeometry(pendingAoi.shape);
    if (pendingAoi.type === 'polyline' && pendingAoi.shape instanceof google.maps.Polyline) return polylineToBboxGeometry(pendingAoi.shape);
    if ('getPath' in pendingAoi.shape) return polygonToGeometry(pendingAoi.shape as google.maps.Polygon);
    throw new Error(`Unsupported drawing type: ${pendingAoi.type}`);
}

function getStoredToken(): string | null {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem('token');
}

export function GMapAOI({ onAoiCreated }: GMapAOIProps) {
    const map = useMap('bhoomi-map');
    const drawing = useMapsLibrary('drawing');
    const [drawingManager, setDrawingManager] = useState<google.maps.drawing.DrawingManager | null>(null);
    const [activeDrawType, setActiveDrawType] = useState<AoiDrawType | null>(null);
    const [pendingAoi, setPendingAoi] = useState<PendingAoi | null>(null);
    const [savedAois, setSavedAois] = useState<any[]>([]);
    const [selectedAoiId, setSelectedAoiId] = useState<string | null>(null);
    const [aoiRenameInput, setAoiRenameInput] = useState('');
    const [isOpen, setIsOpen] = useState(false);
    const [aoiError, setAoiError] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [pendingAoiName, setPendingAoiName] = useState('');
    const savedAoiShapesRef = useRef<Map<string, google.maps.MVCObject>>(new Map());
    const [token, setToken] = useState<string | null>(null);
    const updateTimeoutRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

    useEffect(() => {
        const t = getStoredToken();
        setToken(t);
        const handleStorage = () => setToken(getStoredToken());
        window.addEventListener('storage', handleStorage);
        window.addEventListener('auth-change', handleStorage);
        return () => {
            window.removeEventListener('storage', handleStorage);
            window.removeEventListener('auth-change', handleStorage);
        };
    }, []);

    const clearSavedAoiShapes = () => {
        savedAoiShapesRef.current.forEach(aoi => aoi.setMap(null));
        savedAoiShapesRef.current.clear();
    };

    const loadSavedAois = async () => {
        const token = getStoredToken();
        if (!token || !map) return;
        try {
            const response = await fetch(`${backendUrl}/bhoomi/aoi`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!response.ok) return;
            const data = await response.json();
            
            // Note: We don't want to clear all shapes if we are currently dragging/editing one
            // Instead, we should merge or only update non-selected ones
            if (data.aoi && Array.isArray(data.aoi)) {
                setSavedAois(data.aoi);
                
                // Identify AOIs to remove
                const currentIds = new Set(data.aoi.map((a: any) => String(a.id)));
                savedAoiShapesRef.current.forEach((_, id) => {
                    if (!currentIds.has(id)) {
                        savedAoiShapesRef.current.get(id)?.setMap(null);
                        savedAoiShapesRef.current.delete(id);
                    }
                });

                data.aoi.forEach((aoi: any) => {
                    const aoiId = String(aoi.id);
                    if (savedAoiShapesRef.current.has(aoiId)) return;
                    
                    const shape = createGoogleShapeFromAoi(aoi);
                    if (shape) {
                        savedAoiShapesRef.current.set(aoiId, shape);
                        addAoiListeners(aoiId, shape, aoi);
                    }
                });
            }
        } catch (error) {
            console.error("Error loading AOIs:", error);
        }
    };

    const addAoiListeners = (id: string, shape: google.maps.MVCObject, aoiData: any) => {
        google.maps.event.addListener(shape, 'click', (e: any) => {
            if (e && e.stop) e.stop();
            setSelectedAoiId(id);
            setAoiRenameInput(aoiData.name);
        });

        const updateHandler = () => {
            // Debounce the update
            if (updateTimeoutRef.current.has(id)) {
                clearTimeout(updateTimeoutRef.current.get(id));
            }

            const timeout = setTimeout(() => {
                const converted = convertGoogleObjectToAoi(shape, aoiData.sourceType);
                updateAoiGeometry(id, converted);
                updateTimeoutRef.current.delete(id);
            }, 500); // 500ms debounce

            updateTimeoutRef.current.set(id, timeout);
        };

        if (shape instanceof google.maps.Rectangle) {
            google.maps.event.addListener(shape, 'dragend', updateHandler);
            google.maps.event.addListener(shape, 'bounds_changed', updateHandler);
        } else if (shape instanceof google.maps.Circle) {
            google.maps.event.addListener(shape, 'center_changed', updateHandler);
            google.maps.event.addListener(shape, 'radius_changed', updateHandler);
            google.maps.event.addListener(shape, 'dragend', updateHandler);
        } else if (shape instanceof google.maps.Polygon) {
            google.maps.event.addListener(shape, 'dragend', updateHandler);
            const path = shape.getPath();
            google.maps.event.addListener(path, 'set_at', updateHandler);
            google.maps.event.addListener(path, 'insert_at', updateHandler);
            google.maps.event.addListener(path, 'remove_at', updateHandler);
        }
    };

    const convertGoogleObjectToAoi = (shape: google.maps.MVCObject, sourceType: AoiSourceType): ConvertedAoi => {
        if (shape instanceof google.maps.Rectangle) return rectangleToGeometry(shape);
        if (shape instanceof google.maps.Circle) return circleToGeometry(shape);
        if (shape instanceof google.maps.Polygon) return polygonToGeometry(shape);
        throw new Error("Unsupported shape type for conversion");
    };

    const updateAoiGeometry = async (id: string, update: ConvertedAoi) => {
        const token = getStoredToken();
        if (!token) return;
        setAoiError('');
        try {
            const response = await fetch(`${backendUrl}/bhoomi/aoi/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    geometry: update.geometry,
                    metadata: update.metadata,
                    sourceType: update.sourceType
                })
            });
            if (!response.ok) {
                const err = await response.json();
                console.error("AOI Update Failed:", err);
                setAoiError(err.message || 'Update failed');
            } else {
                console.log("AOI Updated successfully");
            }
        } catch (e) {
            console.error("Failed to update AOI geometry:", e);
            setAoiError('Update failed - network error');
        }
    };

    const createGoogleShapeFromAoi = (aoi: any) => {
        if (!map || !aoi.geometry || aoi.geometry.type !== 'Polygon') return null;
        const coords = aoi.geometry.coordinates[0].map((p: any) => ({ lng: p[0], lat: p[1] }));
        const options = { 
            map, 
            fillOpacity: 0.1, 
            strokeWeight: 2, 
            clickable: true,
            draggable: false, // Default to false
            editable: false    // Default to false
        };
        
        if (aoi.sourceType === 'rectangle') {
            const bounds = new google.maps.LatLngBounds();
            coords.forEach((p: any) => bounds.extend(p));
            return new google.maps.Rectangle({ ...options, bounds, fillColor: '#4285F4', strokeColor: '#4285F4' });
        }
        if (aoi.sourceType === 'circle' && aoi.metadata?.center) {
            return new google.maps.Circle({ ...options, center: aoi.metadata.center, radius: aoi.metadata.radiusMeters, fillColor: '#EA4335', strokeColor: '#EA4335' });
        }
        return new google.maps.Polygon({ ...options, paths: coords, fillColor: '#34A853', strokeColor: '#34A853' });
    };

    // Toggle draggable/editable based on selection
    useEffect(() => {
        savedAoiShapesRef.current.forEach((shape, id) => {
            const isSelected = id === selectedAoiId;
            if ('setDraggable' in shape) shape.setDraggable(isSelected);
            if ('setEditable' in shape) shape.setEditable(isSelected);
            
            // Update visual cues
            if (shape instanceof google.maps.Rectangle || shape instanceof google.maps.Circle || shape instanceof google.maps.Polygon) {
                shape.setOptions({
                    strokeWeight: isSelected ? 3 : 2,
                    fillOpacity: isSelected ? 0.3 : 0.1,
                    strokeOpacity: isSelected ? 1 : 0.8
                });
            }
        });
    }, [selectedAoiId]);

    // Deselect when clicking map
    useEffect(() => {
        if (!map) return;
        const listener = google.maps.event.addListener(map, 'click', () => {
            setSelectedAoiId(null);
        });
        return () => google.maps.event.removeListener(listener);
    }, [map]);

    useEffect(() => {
        if (map && token) {
            loadSavedAois();
            const interval = setInterval(loadSavedAois, 30000);
            return () => { clearInterval(interval); clearSavedAoiShapes(); };
        }
    }, [map, token]);

    useEffect(() => {
        if (!map || !drawing) return;
        const manager = new drawing.DrawingManager({
            drawingMode: null,
            drawingControl: false,
            rectangleOptions: { fillColor: '#4285F4', fillOpacity: 0.3, strokeWeight: 2, strokeColor: '#4285F4', clickable: true, draggable: true },
            circleOptions: { fillColor: '#EA4335', fillOpacity: 0.3, strokeWeight: 2, strokeColor: '#EA4335', clickable: true, draggable: true },
            polygonOptions: { fillColor: '#34A853', fillOpacity: 0.3, strokeWeight: 2, strokeColor: '#34A853', clickable: true, draggable: true },
            polylineOptions: { strokeColor: '#FBBC04', strokeWeight: 3, clickable: true, draggable: true },
        });
        manager.setMap(map);
        setDrawingManager(manager);
        return () => manager.setMap(null);
    }, [map, drawing]);

    useEffect(() => {
        if (!drawingManager) return;
        const listener = (type: AoiDrawType) => (obj: any) => {
            setPendingAoi({ id: Date.now(), type, shape: obj });
            drawingManager.setDrawingMode(null);
            setActiveDrawType(null);
        };
        const events = ['marker', 'rectangle', 'circle', 'polygon', 'polyline'];
        const listeners = events.map(ev => google.maps.event.addListener(drawingManager, `${ev}complete`, listener(ev as AoiDrawType)));
        return () => listeners.forEach(l => google.maps.event.removeListener(l));
    }, [drawingManager]);

    const startDrawing = (type: AoiDrawType) => {
        if (!drawingManager) return;
        const modes = {
            marker: google.maps.drawing.OverlayType.MARKER,
            rectangle: google.maps.drawing.OverlayType.RECTANGLE,
            circle: google.maps.drawing.OverlayType.CIRCLE,
            polygon: google.maps.drawing.OverlayType.POLYGON,
            polyline: google.maps.drawing.OverlayType.POLYLINE,
        };
        drawingManager.setDrawingMode(modes[type]);
        setActiveDrawType(type);
    };

    const cancelDrawing = () => {
        drawingManager?.setDrawingMode(null);
        setActiveDrawType(null);
        if (pendingAoi) { 
            pendingAoi.shape.setMap(null); 
            setPendingAoi(null); 
            setPendingAoiName('');
        }
    };

    const saveAoiToBackend = async (name: string) => {
        if (!pendingAoi) return;
        setAoiError('');
        const token = getStoredToken();
        if (!token) { setAoiError('Sign in to save areas'); return; }
        setIsSaving(true);
        try {
            const converted = convertDrawingToAoi(pendingAoi);
            const response = await fetch(`${backendUrl}/bhoomi/aoi`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ name: name.trim() || 'New Area', ...converted })
            });
            if (!response.ok) throw new Error('Failed to save area');
            const data = await response.json();
            pendingAoi.shape.setMap(null);
            setPendingAoi(null);
            if (onAoiCreated) onAoiCreated(data.id || data.aoiId);
            loadSavedAois();
        } catch (error) {
            setAoiError(error instanceof Error ? error.message : 'Save failed');
        } finally { setIsSaving(false); }
    };

    const renameAoi = async (id: string, newName: string) => {
        if (!token || !newName) return;
        try {
            const response = await fetch(`${backendUrl}/bhoomi/aoi/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ name: newName })
            });
            if (response.ok) {
                setSavedAois(prev => prev.map(a => a.id === id ? { ...a, name: newName } : a));
                setSelectedAoiId(null);
            }
        } catch (e) { console.error("Rename failed:", e); }
    };

    const deleteAoi = async (id: string) => {
        if (!token) return;
        try {
            const response = await fetch(`${backendUrl}/bhoomi/aoi/${id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` }
            });
            if (response.ok) {
                savedAoiShapesRef.current.get(id)?.setMap(null);
                savedAoiShapesRef.current.delete(id);
                setSavedAois(prev => prev.filter(a => a.id !== id));
            }
        } catch (e) { console.error("Delete failed:", e); }
    };

    return (
        <>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`fixed left-4 bottom-8 z-20 bg-white rounded-xl shadow-lg p-3 border-2 ${isOpen ? 'border-blue-500' : 'border-gray-200'} transition-all`}
            >
                <div className="relative">
                    <Square size={24} className={isOpen ? 'text-blue-600' : 'text-gray-700'} />
                    {savedAois.length > 0 && (
                        <span className="absolute -top-2 -right-2 bg-green-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                            {savedAois.length}
                        </span>
                    )}
                </div>
            </button>

            {isOpen && (
                <div className="fixed left-4 bottom-24 z-20 bg-white rounded-2xl shadow-2xl border border-gray-200 w-80 overflow-hidden flex flex-col">
                    <div className="p-4 border-b border-gray-200 bg-slate-50 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="bg-blue-600 p-2 rounded-lg"><MapIcon className="text-white" size={18} /></div>
                            <div>
                                <h3 className="font-semibold text-gray-800 text-sm">Monitor Areas</h3>
                                <p className="text-xs text-gray-500">{savedAois.length} active</p>
                            </div>
                        </div>
                        <button onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
                    </div>

                    {aoiError && !pendingAoi && (
                        <div className="bg-rose-50 border-b border-rose-100 p-2">
                            <p className="text-[10px] text-rose-500 font-bold text-center uppercase tracking-tight">{aoiError}</p>
                        </div>
                    )}

                    <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto custom-scrollbar">
                        <div className="grid grid-cols-2 gap-2">
                            {(['rectangle', 'circle', 'polygon', 'polyline'] as AoiDrawType[]).map(type => (
                                <button
                                    key={type}
                                    onClick={() => startDrawing(type)}
                                    disabled={!!activeDrawType || !!pendingAoi}
                                    className={`flex items-center gap-2 p-3 rounded-lg border-2 transition-all ${activeDrawType === type ? 'bg-blue-50 border-blue-500 text-blue-700' : 'bg-white border-gray-100 hover:border-blue-200'} disabled:opacity-50`}
                                >
                                    {type === 'rectangle' && <Square size={16} />}
                                    {type === 'circle' && <Circle size={16} />}
                                    {type === 'polygon' && <Pentagon size={16} />}
                                    {type === 'polyline' && <Pencil size={16} />}
                                    <span className="text-xs font-medium capitalize">{type === 'polyline' ? 'Line' : type}</span>
                                </button>
                            ))}
                        </div>

                        {activeDrawType && (
                            <button onClick={cancelDrawing} className="w-full py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg text-xs font-semibold transition-colors">
                                Cancel Drawing
                            </button>
                        )}

                        {pendingAoi && (
                            <div className="bg-blue-50 p-3 rounded-xl border border-blue-100 space-y-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-bold text-blue-700 uppercase">New Area detected</span>
                                    <span className="text-[10px] bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full capitalize">{pendingAoi.type}</span>
                                </div>
                                <input 
                                    autoFocus
                                    value={pendingAoiName}
                                    onChange={e => setPendingAoiName(e.target.value)}
                                    placeholder="Name this area..."
                                    className="w-full bg-white border border-blue-200 rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-400"
                                    onKeyDown={e => { if (e.key === 'Enter') saveAoiToBackend(pendingAoiName); if (e.key === 'Escape') cancelDrawing(); }}
                                />
                                <div className="flex gap-2">
                                    <button 
                                        onClick={() => saveAoiToBackend(pendingAoiName)}
                                        disabled={isSaving}
                                        className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-[10px] font-bold hover:bg-blue-700 disabled:opacity-50"
                                    >
                                        {isSaving ? 'Saving...' : 'Save Area'}
                                    </button>
                                    <button onClick={cancelDrawing} className="px-3 py-2 border border-blue-200 text-blue-600 rounded-lg text-[10px] font-bold hover:bg-blue-50">
                                        Cancel
                                    </button>
                                </div>
                                {aoiError && (
                                    <p className="text-[10px] text-rose-500 font-medium animate-pulse">{aoiError}</p>
                                )}
                            </div>
                        )}

                        {savedAois.length > 0 && (
                            <div className="space-y-2">
                                <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-1">Active AOIs</h4>
                                {savedAois.map(aoi => (
                                    <div key={aoi.id} className="group bg-white border border-gray-100 rounded-xl p-3 hover:border-blue-200 hover:shadow-sm transition-all">
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="flex-1 min-w-0" onClick={() => { setSelectedAoiId(aoi.id); setAoiRenameInput(aoi.name); }}>
                                                {selectedAoiId === aoi.id ? (
                                                    <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                                                        <input 
                                                            autoFocus
                                                            value={aoiRenameInput}
                                                            onChange={e => setAoiRenameInput(e.target.value)}
                                                            className="flex-1 text-xs font-semibold bg-slate-50 rounded px-2 py-1 outline-none border border-blue-200"
                                                            onKeyDown={e => { if (e.key === 'Enter') renameAoi(aoi.id, aoiRenameInput); if (e.key === 'Escape') setSelectedAoiId(null); }}
                                                        />
                                                    </div>
                                                ) : (
                                                    <p className="text-xs font-semibold text-gray-800 truncate cursor-pointer hover:text-blue-600">{aoi.name}</p>
                                                )}
                                                <div className="flex items-center gap-2 mt-1">
                                                    <span className="text-[9px] text-gray-400 font-medium uppercase">{aoi.sourceType || 'Area'}</span>
                                                    <span className="text-[9px] text-emerald-500 font-bold">Active</span>
                                                </div>
                                            </div>
                                            <button onClick={() => deleteAoi(aoi.id)} className="opacity-0 group-hover:opacity-100 p-1 text-rose-400 hover:text-rose-600 transition-all"><Trash2 size={14} /></button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                        
                        {savedAois.length === 0 && !pendingAoi && !activeDrawType && (
                            <div className="py-10 text-center opacity-40">
                                <RefreshCw className="mx-auto mb-2 text-gray-300" size={32} />
                                <p className="text-[10px] font-medium">Draw an area to start monitoring</p>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </>
    );
}