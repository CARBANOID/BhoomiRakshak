type MapCoords = {
    lat: number ,
    lng: number    
}

class gmap {
    private map : any ;
    private innerMap  : any ;

    private center : MapCoords = {
        lat: 38.7946,   // lat : {-90,90} degree // north sourh from equator 
        lng: -106.5348  // lng : {-180,180} degree // east west from prime meridian
    } ;
    private scale  : number = 5 ;

    constructor(map : any){
        this.map = map ;
        this.innerMap = map.innerMap ; 
        this.innerMap.setOptions({
            mapTypeControl: false,
        }); 
    }
}

export {gmap} ;