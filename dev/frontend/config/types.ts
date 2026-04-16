type mapType =  'roadmap' | 'satellite' | 'hybrid' | 'terrain' ;
type geoCoordsType = { lat: number , lng: number } ;
export type GoogleMapShapes = google.maps.Rectangle | google.maps.Circle | google.maps.Polygon | google.maps.Polyline ;
export type ShapeType = 'rectangle' | 'circle' | 'polygon' | 'polyline';
export type DrawnShape = {
    id: number | string;
    type: ShapeType;
    alais? : string ;
    shape: google.maps.Rectangle | google.maps.Circle | google.maps.Polygon | google.maps.Polyline;
}

export type { mapType , geoCoordsType } ;