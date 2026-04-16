import type { ShapeType , DrawnShape } from '@/config/types';
import { ShapeLabelType } from "@/component/ShapeOptions";
import { GoogleMapShapes } from "@/config/types";
import { useMap, useMapsLibrary } from "@vis.gl/react-google-maps";
import { backendUrl } from '@/config/backendUrl';
import ky from 'ky';
const drawing = useMapsLibrary('drawing') ;

export class DrawShape{
    private map             : ReturnType<typeof useMap> ;
    private drawingManager! : google.maps.drawing.DrawingManager ;
    private shapes          : DrawnShape[] = [];
    private selectedShape   : ShapeLabelType = null ; 
    private selectedShapeId : number = -1; 
    public activeShape      : ShapeType | null = null ;
    public alais            : string = ''; 

    constructor(map : ReturnType<typeof useMap>){
        this.map = map ;
        // this.map = useMap('bhoomi-map') ; 
        this.initDrawingManager() ;
    }

    initDrawingManager = () =>{
        if(!drawing) return ;

        this.drawingManager = new drawing.DrawingManager({
            drawingMode: null,
            drawingControl: false,
            rectangleOptions: {
                fillColor: '#4285F4',
                fillOpacity: 0.3,
                strokeWeight: 2,
                strokeColor: '#4285F4',
                clickable: true,
                editable: false,
                draggable: true,
            },
            circleOptions: {
                fillColor: '#EA4335',
                fillOpacity: 0.3,
                strokeWeight: 2,
                strokeColor: '#EA4335',
                clickable: true,
                editable: false,
                draggable: true,
            },
            polygonOptions: {
                fillColor: '#34A853',
                fillOpacity: 0.3,
                strokeWeight: 2,
                strokeColor: '#34A853',
                clickable: true,
                editable: false,
                draggable: true,
            },
            polylineOptions: {
                strokeColor: '#FBBC04',
                strokeWeight: 3,
                clickable: true,
                editable: false,
                draggable: true,
            },
        });
    }

    ShapeClickListener = (id : number,shape : GoogleMapShapes) =>{
        google.maps.event.addListener(shape, 'shapeClick', () => {
            this.selectedShapeId = id ; 
        }) ;
    }

    DrawingEvents = {
        CommonCode : () =>{
            this.drawingManager.setDrawingMode(null);
            this.activeShape = null ;
            this.alais = '' ;
        },
        onRectangleComplete: async(rectangle : google.maps.Rectangle) =>{   
            rectangle.setEditable(false) ; 
            const shapeCreated = await this.createShape("rectangle",rectangle,this.alais) ; 
            this.shapes.push(shapeCreated) ;  
            this.DrawingEvents.CommonCode() ;
            this.ShapeClickListener(shapeCreated.id,rectangle)
        },
        onCircleComplete:   async(circle : google.maps.Circle) => {
            circle.setEditable(false) ; 
            const shapeCreated = await this.createShape("circle",circle,this.alais) ; 
            this.shapes.push(shapeCreated) ;  
            this.DrawingEvents.CommonCode() ;
            this.ShapeClickListener(shapeCreated.id,circle)   
        },
        onPolygonComplete:  async(polygon : google.maps.Polygon) =>   { 
            polygon.setEditable(false) ; 
            const shapeCreated = await this.createShape("polygon",polygon,this.alais) ; 
            this.shapes.push(shapeCreated) ;  
            this.DrawingEvents.CommonCode() ;
            this.ShapeClickListener(shapeCreated.id,polygon)
        }, 
        onPolylineComplete: async(polyline : google.maps.Polyline) =>{   
            polyline.setEditable(false) ; 
            const shapeCreated = await this.createShape("polyline",polyline,this.alais) ; 
            this.shapes.push(shapeCreated) ;  
            this.DrawingEvents.CommonCode() ;
            this.ShapeClickListener(shapeCreated.id,polyline)
        },

    }

    initDrawingEvents = () =>{
        google.maps.event.addListener(this.drawingManager,'rectanglecomplete',this.DrawingEvents.onRectangleComplete) ;
        google.maps.event.addListener(this.drawingManager,'circlecomplete',this.DrawingEvents.onCircleComplete) ;
        google.maps.event.addListener(this.drawingManager,'polygoncomplete',this.DrawingEvents.onPolygonComplete) ;
        google.maps.event.addListener(this.drawingManager,'polylinecomplete',this.DrawingEvents.onPolylineComplete) ;   
    }

    startDrawing = (shapeType: ShapeType) => {
        const drawingModeMap = {
            rectangle: google.maps.drawing.OverlayType.RECTANGLE,
            circle: google.maps.drawing.OverlayType.CIRCLE,
            polygon: google.maps.drawing.OverlayType.POLYGON,
            polyline: google.maps.drawing.OverlayType.POLYLINE,
        };
        this.drawingManager.setDrawingMode(drawingModeMap[shapeType]);
        this.activeShape = shapeType ;
    };

    cancelDrawing = () => {
        this.drawingManager.setDrawingMode(null);
        this.selectedShape = null ;
    };

    deleteShape = async(id : number) =>{
        const index = this.shapes.findIndex(s => s.id === id) ;
        if(index == -1) return ;
        this.shapes.splice(index,1) ;
        const response = await ky.post(`${backendUrl}/bhoomi/delete-shape`,{
            json : {
                shapeId : id
            }
        })
    }

    clearAllShapes = () => {
        // send backend request to delete all shapes
        this.shapes = [] ;
        this.selectedShapeId = -1 ;
        this.selectedShape = null ;
    };
    
    cleanupEvents = () =>{
        google.maps.event.clearListeners(this.drawingManager,'rectanglecomplete') ;
        google.maps.event.clearListeners(this.drawingManager,'circlecomplete') ;
        google.maps.event.clearListeners(this.drawingManager,'polygoncomplete') ;
        google.maps.event.clearListeners(this.drawingManager,'polylinecomplete') ;   
        google.maps.event.clearListeners(this.drawingManager,'shapeClick') ;           
    }

    createShape = async(type : ShapeType,shape : GoogleMapShapes, alais: string) =>{
        const response = await ky.post(`${backendUrl}/bhoomi/create-shape`,{
            json : {
                type : type,
                shape : shape ,
                alais : alais
            }
        })
        const data : any = await response.json() ;
        const id : number = data.shapeId ;
        return {id,alais,type,shape} ;
    }
}