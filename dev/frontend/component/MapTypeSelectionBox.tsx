import { useState } from "react";
import { Map , Satellite , Layers , Mountain } from 'lucide-react';
import { mapType } from "@/config/types";


export function MapTypeSelectionBox({selectedMapType, changeMapType}: {selectedMapType: mapType, changeMapType: (mapType: mapType) => void}) {
    const [isOpen, setIsOpen] = useState(false);

    const handleTypeChange = (type: mapType) => {
        changeMapType(type);
        setIsOpen(false);
    };

    const mapTypes : Array<{ id: mapType, label: string, icon: React.ElementType, description: string }> = [
        { id: 'roadmap', label: 'Roadmap', icon: Map, description: 'Street map view' },
        { id: 'satellite', label: 'Satellite', icon: Satellite, description: 'Satellite imagery' },
        { id: 'hybrid', label: 'Hybrid', icon: Layers, description: 'Satellite with labels' },
        { id: 'terrain', label: 'Terrain', icon: Mountain, description: 'Topographic view' }
    ];

    const selectedTypeData = mapTypes.find(t => t.id === selectedMapType);
    const SelectedIcon = selectedTypeData?.icon;

    return (
        <div className="absolute top-4 right-4  z-10">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="bg-white rounded-lg shadow-lg px-4 py-2 flex items-center gap-2 hover:bg-gray-50 transition-colors border border-gray-200"
            >
                {SelectedIcon && (
                    <SelectedIcon size={18} className="text-blue-600" />
                )}
                <span className="font-medium text-gray-700 text-sm">
                    {selectedTypeData?.label}
                </span>
                <svg 
                    className={`w-4 h-4 text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                    fill="none" 
                    stroke="currentColor" 
                    viewBox="0 0 24 24"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>
            
            {/* Dropdown Menu */}
            {isOpen && (
                <div className="absolute top-12 right-0 bg-white rounded-lg shadow-xl border border-gray-200 overflow-hidden min-w-[220px]">
                    {mapTypes.map((type) => {
                        const Icon = type.icon;
                        const isSelected = selectedMapType === type.id;
                        
                        return (
                            <button
                                key={type.id}
                                onClick={() => handleTypeChange(type.id as mapType)}
                                className={`w-full px-4 py-3 flex items-start gap-3 hover:bg-blue-50 transition-colors border-b border-gray-100 last:border-b-0 ${
                                    isSelected ? 'bg-blue-50' : ''
                                }`}
                            >
                                <Icon 
                                    size={20} 
                                    className={`mt-0.5 ${isSelected ? 'text-blue-600' : 'text-gray-500'}`}
                                />
                                <div className="text-left flex-1">
                                    <div className={`font-medium text-sm ${
                                        isSelected ? 'text-blue-600' : 'text-gray-700'
                                    }`}>
                                        {type.label}
                                    </div>
                                    <div className="text-xs text-gray-500 mt-0.5">
                                        {type.description}
                                    </div>
                                </div>
                                {isSelected && (
                                    <svg className="w-5 h-5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                    </svg>
                                )}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
