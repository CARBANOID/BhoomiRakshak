import { geoCoordsType } from '@/config/types';
import { useMap } from '@vis.gl/react-google-maps';
import { MapPin, X, Navigation, Trash2 } from 'lucide-react';
import { useState } from 'react';

type PinnedLocationSideBarProps = {
    pinnedLocations:  { name: string; location: geoCoordsType }[];
    onLocationDelete: (index: number) => void;
};

export function PinnedLocationSideBar({pinnedLocations,onLocationDelete}: PinnedLocationSideBarProps) {
    const [isOpen, setIsOpen] = useState(false);
    const toggleSidebar = () => setIsOpen(!isOpen);

    return (
        <>
            {/* Toggle Button */}
            <button
                onClick={toggleSidebar}
                className={`fixed left-4 top-4 z-20 bg-white rounded-xl shadow-lg p-3 hover:shadow-xl transition-all duration-300 border border-gray-200 group ${
                    isOpen ? 'translate-x-80' : ''
                }`}
            >
                <div className="relative">
                    <MapPin 
                        size={24} 
                        className={`transition-colors ${isOpen ? 'text-blue-600' : 'text-gray-700 group-hover:text-blue-600'}`}
                    />
                    {pinnedLocations.length > 0 && (
                        <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                            {pinnedLocations.length}
                        </span>
                    )}
                </div>
            </button>

            {/* Sidebar Panel */}
            <div
                className={`fixed left-0 top-0 h-full w-80 bg-white shadow-2xl z-10 transform transition-transform duration-300 ease-in-out ${
                    isOpen ? 'translate-x-0' : '-translate-x-full'
                }`}
            >
                <div className="h-full flex flex-col">
                    {/* Header */}
                    <div className="p-4 border-b border-gray-200 bg-linear-to-r from-blue-50 to-indigo-50">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="bg-blue-600 p-2 rounded-lg">
                                    <MapPin className="text-white" size={20} />
                                </div>
                                <div>
                                    <h2 className="text-xl font-bold text-gray-800">My Pins</h2>
                                    <p className="text-sm text-gray-600">{pinnedLocations.length} location{pinnedLocations.length !== 1 ? 's' : ''}</p>
                                </div>
                            </div>
                            <button
                                onClick={toggleSidebar}
                                className="text-gray-500 hover:text-gray-700 p-2 hover:bg-white rounded-lg transition-colors"
                            >
                                <X size={20} />
                            </button>
                        </div>
                    </div>

                    {/* Pinned Locations List */}
                    <div className="flex-1 overflow-y-auto">
                        <PinnedLocations
                            pinnedLocations={pinnedLocations}
                            onLocationDelete={onLocationDelete}
                        />
                    </div>
                </div>
            </div>
        </>
    );
}

function PinnedLocations({pinnedLocations, onLocationDelete} : PinnedLocationSideBarProps) {
    const MapRef = useMap('bhoomi-map') ;
    const onLocationClick = (center : geoCoordsType) => (MapRef) ? MapRef.setCenter(center) : null ;    

    if (pinnedLocations.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center">
                <div className="bg-gray-100 p-6 rounded-full mb-4">
                    <MapPin size={48} className="text-gray-400" />
                </div>
                <h3 className="text-lg font-semibold text-gray-700 mb-2">No pins yet</h3>
                <p className="text-sm text-gray-500 max-w-xs">
                    Start adding locations to your map by clicking the "Add Pin" button below
                </p>
            </div>
        );
    }

    return (
        <div className="p-4 space-y-3">
            {pinnedLocations.map((pin, index) => (
                <div
                    key={`${pin.location.lat}-${pin.location.lng}-${index}`}
                    className="group bg-white border-2 border-gray-200 rounded-xl p-4 hover:border-blue-400 hover:shadow-lg transition-all duration-200"
                >
                    <div className="flex items-start gap-3">
                        {/* Icon */}
                        <div className="bg-blue-100 p-2 rounded-lg shrink-0 group-hover:bg-blue-200 transition-colors">
                            <MapPin size={20} className="text-blue-600" />
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-gray-800 mb-1 truncate">
                                {pin.name}
                            </h3>
                            <div className="flex items-center gap-2 text-xs text-gray-500">
                                <span className="font-mono">
                                    {pin.location.lat.toFixed(4)}°, {pin.location.lng.toFixed(4)}°
                                </span>
                            </div>

                            {/* Action Buttons */}
                            <div className="flex gap-2 mt-3">
                                <button
                                    onClick={() => onLocationClick(pin.location)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors text-xs font-medium cursor-pointer"
                                >
                                    <Navigation size={14} />
                                    <span>Navigate</span>
                                </button>
                                <button
                                    onClick={() => onLocationDelete(index)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors text-xs font-medium cursor-pointer"
                                >
                                    <Trash2 size={14} />
                                    <span>Delete</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}
