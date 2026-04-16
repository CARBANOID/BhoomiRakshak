'use client'

import LoadingPage from '@/component/Loading'
import { GoogleMapsAPI, MapId } from '@/config/keys'
import { useMemo, useRef, useState } from 'react'
import { APIProvider , Map , MapCameraChangedEvent , MapMouseEvent } from '@vis.gl/react-google-maps'
import { geoCoordsType, mapType } from '@/config/types'
import { MapTypeSelectionBox } from '@/component/MapTypeSelectionBox'
import { PinBox } from '@/component/PinBox'
import { PinnedLocationSideBar } from '@/component/PinnedLocationSideBar'
import { MapPinnedLocation } from '@/component/MapPinnedLocation'
import { GMapShape } from '@/component/GMapShape'
import { SearchInputBox } from '@/component/SearchInputBox'

type MapStateType = {  
    center : geoCoordsType ,
    scale  : number ,
    mapTypeId : mapType 
}

const DefaultMapState : MapStateType = {
    center : { lat: 38.7946 , lng: -106.5348 } ,
    scale  : 5 , 
    mapTypeId : 'hybrid'
}

export default function MapPage(){
    const [Loading,setLoading] = useState(true) ; 
    const [map,setMap] = useState<MapStateType>(DefaultMapState) ;
    const changeMapType = (mapType : mapType) => setMap({...map , mapTypeId : mapType}) ;

    const [pinActive,setPinActive] = useState<boolean>(false) ;
    const [pinnedLocations,setPinnedLocations] = useState<{ name:string,location:geoCoordsType}[]>([]); // get from Backend in future
    const cachedPinnedLocations = useMemo(() => pinnedLocations,[pinnedLocations])
    const pinnedLocationNameRef = useRef<HTMLInputElement>(null);
    const TogglePinActive = () => setPinActive(!pinActive) ;
    const DeletePin = (index : number) => setPinnedLocations(pinnedLocations.filter((pin : { name : string, location: geoCoordsType }, i) => i !== index)) ; 

    
    return (
        <APIProvider  
            apiKey= {GoogleMapsAPI}  
            onLoad= { () => setLoading(false) }
            region='IN-UK'
            language='EN'
        > 
            <div className='h-screen w-screen'>
                <MapTypeSelectionBox 
                    selectedMapType={map.mapTypeId} 
                    changeMapType={changeMapType} 
                />
                <PinBox 
                    pinnedLocationNameRef={pinnedLocationNameRef} 
                    TogglePinActive={TogglePinActive}
                    pinActive={pinActive}
                />
                <PinnedLocationSideBar 
                    pinnedLocations={pinnedLocations}
                    onLocationDelete={DeletePin}
                />
                {/* <div className="absolute top-4 left-1/2 transform -translate-x-[185px] z-10 w-96">
                    <SearchInputBox />
                </div> */}
                <Map
                    id= 'bhoomi-map'
                    mapId={MapId}
                    mapTypeId= {map.mapTypeId}
                    defaultCenter= {map.center}
                    defaultZoom= {map.scale}
                    onCameraChanged={ (ev: MapCameraChangedEvent) =>
                        console.log('camera changed:', ev.detail.center, 'zoom:', ev.detail.zoom)
                    }
                    fullscreenControl = {false}
                    onClick= { (ev: MapMouseEvent) => {
                        if (pinActive) {
                            if(!ev.detail.latLng || !pinnedLocationNameRef.current) return;
                            if(pinnedLocationNameRef.current.value === ""){
                                pinnedLocationNameRef.current.focus() ;
                                return ;    
                            }
                            const lat = ev.detail.latLng.lat;
                            const lng = ev.detail.latLng.lng;
                            setPinnedLocations([...pinnedLocations, { name: pinnedLocationNameRef.current.value, location: { lat, lng } }]);
                            TogglePinActive() ;
                            pinnedLocationNameRef.current.value = "" ;
                        }
                    }}
                    mapTypeControl = {true}
                    mapTypeControlOptions={{
                        position: 1
                    }}
                    // streetViewControl={true}
                    // streetViewControlOptions={{
                    //     position: 7  // RIGHT_BOTTOM
                    // }}
                    className='h-full w-full'
                >
                    <MapPinnedLocation pinnedLocations={cachedPinnedLocations} />
                    <GMapShape />
                </Map>
            </div>
        </APIProvider>
    )
}
