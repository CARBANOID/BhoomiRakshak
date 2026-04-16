import { useMap, useMapsLibrary } from "@vis.gl/react-google-maps";
import { useEffect, useRef } from "react";

export const SearchInputBox = () => {
  const map = useMap("bhoomi-map");
  const places = useMapsLibrary('places') ;
  const inputRef = useRef<HTMLInputElement>(null) ;

  useEffect(() =>{
    if(!map || !places || !inputRef.current) return ;

    const searchBox = new places.SearchBox(inputRef.current) ;

    map.addListener("bounds_changed", () => {3
      searchBox.setBounds(map.getBounds() as google.maps.LatLngBounds);
    });
    
    let markers: google.maps.marker.AdvancedMarkerElement[] = [];

    searchBox.addListener("places_changed", () => {
      const locations = searchBox.getPlaces();
      if (!locations || locations.length == 0)  return;

      markers.forEach((marker) => {
        marker.map = null;
      });
      
      markers = [];

      // For each place, get the icon, name and location.
      const bounds = new google.maps.LatLngBounds();

      locations.forEach((place) => {
        if (!place.geometry || !place.geometry.location) {
          console.log("Returned place contains no geometry");
          return;
        }

        const pinElement = new google.maps.marker.PinElement({
          background: "#FBBC04",
          borderColor: "#137333",
          glyphColor: "#137333",
          scale: 1.2,
        });

        // Create a marker for each place.
        markers.push(
          new google.maps.marker.AdvancedMarkerElement({
            map,
            content : pinElement.element ,
            title: place.name,
            position: place.geometry.location,
          })
        );

        if (place.geometry.viewport) bounds.union(place.geometry.viewport);
        else bounds.extend(place.geometry.location);      
      });

      map.fitBounds(bounds);

    }) ; 

  },[map, places ,inputRef.current]) ;
  
  return(
    <input 
      type="text" 
      ref={inputRef}
      className="bg-white rounded-2xl shadow-md w-full px-4 py-[7px] focus:outline-none focus:ring-2 focus:ring-blue-500"
      placeholder="Enter the place"
    />
  )
}