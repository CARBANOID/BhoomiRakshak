import { geoCoordsType } from "@/config/types";
import { AdvancedMarker , Pin } from "@vis.gl/react-google-maps";

export function MapPinnedLocation({pinnedLocations}:{pinnedLocations:{ name:string,location:geoCoordsType}[]}) {
    return (
        <>
            {pinnedLocations.map((pin) => (
                <AdvancedMarker
                    key={`${pin.location.lat},${pin.location.lng}`}
                    position={pin.location}
                    title={pin.name}
                >
                    <Pin background={'#FBBC04'} glyphColor={'#000'} borderColor={'#000'} />
                </AdvancedMarker>
            ))}
        </>
    );
}
