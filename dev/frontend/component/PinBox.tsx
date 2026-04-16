import { MapPin, X } from 'lucide-react';

export function PinBox({
    pinnedLocationNameRef,
    TogglePinActive,
    pinActive
}: {
    pinnedLocationNameRef: React.RefObject<HTMLInputElement | null>,
    TogglePinActive: () => void,
    pinActive: boolean
}) {
    return (
        <div className="fixed bottom-8 left-1/2 transform -translate-x-1/2 z-10">
            <div className={`bg-white rounded-2xl shadow-2xl border border-gray-200 transition-all duration-300 ${
                pinActive ? 'w-80 p-4' : 'w-auto'
            }`}>
                {pinActive ? (
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <div className="bg-blue-100 p-2 rounded-lg">
                                    <MapPin className="text-blue-600" size={20} />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-gray-800 text-sm">Add Location Pin</h3>
                                    <p className="text-xs text-gray-500">Click map to place marker</p>
                                </div>
                            </div>
                            <button
                                onClick={TogglePinActive}
                                className="text-gray-400 hover:text-gray-600 transition-colors p-1 hover:bg-gray-100 rounded-lg"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div className="relative">
                            <input
                                type="text"
                                ref={pinnedLocationNameRef}
                                placeholder="Enter location name..."
                                className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none transition-colors text-sm placeholder:text-gray-400"
                                autoFocus
                            />
                        </div>

                        <div className="flex items-start gap-2 bg-blue-50 p-3 rounded-lg">
                            <div className="bg-blue-200 w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5">
                                <span className="text-blue-700 text-xs font-bold">i</span>
                            </div>
                            <p className="text-xs text-blue-700 leading-relaxed">
                                Enter a name above, then click anywhere on the map to place your marker
                            </p>
                        </div>
                    </div>
                ) : (
                    <button
                        onClick={TogglePinActive}
                        className="flex items-center gap-3 px-6 py-3 hover:bg-gray-50 transition-all duration-200 rounded-2xl group"
                    >
                        <div className="bg-linear-to-br from-blue-500 to-blue-600 p-2.5 rounded-xl shadow-lg group-hover:shadow-xl group-hover:scale-110 transition-all duration-200">
                            <MapPin className="text-white" size={20} />
                        </div>
                        <div className="text-left">
                            <div className="font-semibold text-gray-800 text-sm">Add Pin</div>
                            <div className="text-xs text-gray-500">Mark a location</div>
                        </div>
                    </button>
                )}
            </div>
        </div>
    );
}