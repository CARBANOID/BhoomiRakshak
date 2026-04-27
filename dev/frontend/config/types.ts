type mapType =  'roadmap' | 'satellite' | 'hybrid' | 'terrain' ;
type geoCoordsType = { lat: number , lng: number } ;
export type GoogleMapAoiObjects = google.maps.Rectangle | google.maps.Circle | google.maps.Polygon | google.maps.Polyline ;
export type AoiDrawType = 'rectangle' | 'circle' | 'polygon' | 'polyline' | 'marker';
export type PendingAoi = {
    id: number | string;
    type: AoiDrawType;
    name? : string ;
    shape: GoogleMapAoiObjects | google.maps.Marker;
}

export type { mapType , geoCoordsType } ;