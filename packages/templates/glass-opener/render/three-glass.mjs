import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

// One irregular fracture contour is shared by both extruded halves.
const FRACTURE = [
  [-11.56,.76],[-10.5,.66],[-9.1,.48],[-8.5,.82],[-7.2,.13],[-5.7,.32],
  [-4.8,-.29],[-3.9,.11],[-2.1,-.30],[-.9,.04],[.15,-.53],
  [.6,-.16],[2.3,-.31],[3.4,-.87],[4.1,-.39],[5.8,-.64],
  [6.7,-.45],[7.3,-1.04],[8.2,-.68],[9.5,-1.02],[10.5,-.81],[11.56,-.96]
];
const HALF_W=11.56, HALF_H=6.5025;
const pxToWorld=18/1920;

const chippedEdge = points => {
  const result=[];
  for(let i=0;i<points.length-1;i++) {
    const a=points[i],b=points[i+1];
    const count=Math.max(2,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/.13));
    for(let k=0;k<count;k++) {
      const t=k/count;
      const n=Math.sin((i+1)*71.17+(k+3)*13.71)*43758.5453;
      const micro=(n-Math.floor(n)-.5)*.06*Math.sin(Math.PI*t);
      result.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t+micro]);
    }
  }
  result.push(points.at(-1));
  return result;
};
const makeShape = (top,reverseSlope) => {
  const edge=chippedEdge(FRACTURE.map(([x,y])=>[x,reverseSlope?-y:y]));
  const shape=new THREE.Shape();
  if (top) {
    shape.moveTo(-HALF_W,HALF_H); shape.lineTo(HALF_W,HALF_H);
    [...edge].reverse().forEach(([x,y])=>shape.lineTo(x,y));
  } else {
    shape.moveTo(edge[0][0],edge[0][1]);
    edge.slice(1).forEach(([x,y])=>shape.lineTo(x,y));
    shape.lineTo(HALF_W,-HALF_H); shape.lineTo(-HALF_W,-HALF_H);
  }
  shape.closePath();
  return {shape,edge};
};

const photoTexture = (image,fractureImage,edgeImage,top,reverseSlope) => {
  const c=document.createElement("canvas"); c.width=1920; c.height=1080;
  const ctx=c.getContext("2d");
  const s=Math.max(c.width/image.naturalWidth,c.height/image.naturalHeight);
  const w=c.width/s,h=c.height/s;
  ctx.drawImage(image,(image.naturalWidth-w)/2,(image.naturalHeight-h)/2,w,h,0,0,c.width,c.height);
  const shade=ctx.createLinearGradient(0,0,c.width,0);
  shade.addColorStop(0,"rgba(4,10,16,.54)");
  shade.addColorStop(.51,"rgba(4,10,16,.30)");
  shade.addColorStop(.90,"rgba(4,10,16,.06)");
  ctx.fillStyle=shade; ctx.fillRect(0,0,c.width,c.height);
  // Keep the strongest fracture detail close to the actual cut contour.
  // Farther from it, only a very faint glass texture remains.
  const detail=document.createElement("canvas"); detail.width=c.width; detail.height=c.height;
  const detailCtx=detail.getContext("2d");
  const offset=top?-35:28;
  detailCtx.drawImage(fractureImage,0,0,fractureImage.naturalWidth,fractureImage.naturalHeight,
    -22,offset-115,1964,1309);
  const maskCanvas=document.createElement("canvas"); maskCanvas.width=c.width; maskCanvas.height=c.height;
  const maskCtx=maskCanvas.getContext("2d");
  const edgeCanvas=document.createElement("canvas"); edgeCanvas.width=c.width; edgeCanvas.height=c.height;
  const edgeCtx=edgeCanvas.getContext("2d");
  const edgeMask=document.createElement("canvas"); edgeMask.width=c.width; edgeMask.height=c.height;
  const edgeMaskCtx=edgeMask.getContext("2d");
  for(let px=0;px<c.width;px+=4) {
    const x=px/c.width*HALF_W*2-HALF_W;
    let i=0;
    while(i<FRACTURE.length-2&&FRACTURE[i+1][0]<x)i++;
    const a=FRACTURE[i],b=FRACTURE[i+1];
    const t=Math.max(0,Math.min(1,(x-a[0])/(b[0]-a[0])));
    let y=a[1]+(b[1]-a[1])*t;
    if(reverseSlope)y=-y;
    const seam=(HALF_H-y)/(HALF_H*2)*c.height;
    const mask=maskCtx.createLinearGradient(0,seam-260,0,seam+260);
    mask.addColorStop(0,"rgba(255,255,255,.035)");
    mask.addColorStop(.22,"rgba(255,255,255,.07)");
    mask.addColorStop(.38,"rgba(255,255,255,.42)");
    mask.addColorStop(.5,"rgba(255,255,255,1)");
    mask.addColorStop(.62,"rgba(255,255,255,.42)");
    mask.addColorStop(.78,"rgba(255,255,255,.07)");
    mask.addColorStop(1,"rgba(255,255,255,.035)");
    maskCtx.fillStyle=mask; maskCtx.fillRect(px,0,4,c.height);
    // Follow the fracture contour with a slice of an actual broken-glass
    // texture, concentrating the small reflective chips on the cut itself.
    const sourceX=edgeImage.naturalWidth*(.15+.70*px/c.width);
    const sourceWidth=edgeImage.naturalWidth*.70*4/c.width;
    edgeCtx.drawImage(edgeImage,sourceX,edgeImage.naturalHeight*.22,sourceWidth,edgeImage.naturalHeight*.56,
      px,seam-150,4,300);
    const edgeFade=edgeMaskCtx.createLinearGradient(0,seam-150,0,seam+150);
    edgeFade.addColorStop(0,"rgba(255,255,255,0)");
    edgeFade.addColorStop(.27,"rgba(255,255,255,.35)");
    edgeFade.addColorStop(.5,"rgba(255,255,255,1)");
    edgeFade.addColorStop(.73,"rgba(255,255,255,.35)");
    edgeFade.addColorStop(1,"rgba(255,255,255,0)");
    edgeMaskCtx.fillStyle=edgeFade; edgeMaskCtx.fillRect(px,0,4,c.height);
  }
  detailCtx.globalCompositeOperation="destination-in";
  detailCtx.drawImage(maskCanvas,0,0);
  // Keep the fracture on the glass itself while the picture inside each
  // piece follows its own camera move.
  const fxCanvas=document.createElement("canvas"); fxCanvas.width=c.width; fxCanvas.height=c.height;
  const fxCtx=fxCanvas.getContext("2d");
  fxCtx.fillStyle="black"; fxCtx.fillRect(0,0,c.width,c.height);
  fxCtx.globalCompositeOperation="screen";
  fxCtx.globalAlpha=top?.94:.86;
  fxCtx.drawImage(detail,0,0);
  edgeCtx.globalCompositeOperation="destination-in";
  edgeCtx.drawImage(edgeMask,0,0);
  fxCtx.globalAlpha=top?.78:.70;
  fxCtx.drawImage(edgeCanvas,0,0);
  const photo=new THREE.CanvasTexture(c); photo.colorSpace=THREE.SRGBColorSpace;
  photo.anisotropy=4; photo.center.set(.5,.5);
  const fracture=new THREE.CanvasTexture(fxCanvas); fracture.colorSpace=THREE.SRGBColorSpace;
  fracture.anisotropy=4;
  return {photo,fracture};
};

const imageGeometry = shape => {
  const geometry=new THREE.ShapeGeometry(shape);
  const pos=geometry.attributes.position, uv=geometry.attributes.uv;
  for (let i=0;i<pos.count;i++) uv.setXY(i,(pos.getX(i)+HALF_W)/(HALF_W*2),(pos.getY(i)+HALF_H)/(HALF_H*2));
  uv.needsUpdate=true;
  return geometry;
};

const addFineCracks = (group,edge,top) => {
  const material=new THREE.LineBasicMaterial({color:0xd8e8e5,transparent:true,opacity:.24,depthWrite:false});
  for (const [position,a,b] of [[.12,.32,.45],[.29,-.28,.55],[.57,.29,.38],[.79,-.3,.58]]) {
    const [x,y]=edge[Math.round(position*(edge.length-1))], dy=top?1:-1;
    const pts=[new THREE.Vector3(x,y,.36),new THREE.Vector3(x+a,y+dy*.18,.36),
      new THREE.Vector3(x+a*.60,y+dy*b,.36),new THREE.Vector3(x+a*1.3,y+dy*(b+.23),.36)];
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),material));
  }
};

// Broken edge facets are small, uneven, and attached to each pane. Vary the
// depth and reflected brightness so the seam reads as glass instead of a
// continuous bright outline.
const addEdgeFacets = (group,edge,top) => {
  const vertices=[],colors=[];
  const dy=top?1:-1;
  for(let i=1;i<edge.length-4;) {
    const noise=n=>{const v=Math.sin((i+3)*31.67+n*51.41)*47513.73;return v-Math.floor(v);};
    const count=2+Math.floor(noise(1)*4),a=edge[i],b=edge[Math.min(i+count,edge.length-1)];
    if(noise(2)>.16) {
      const h=.02+noise(3)*.075;
      const mx=a[0]+(b[0]-a[0])*(.22+noise(4)*.56);
      const my=a[1]+(b[1]-a[1])*.5+dy*h;
      vertices.push(a[0],a[1],.35,b[0],b[1],.35,mx,my,.35);
      const light=.24+noise(5)*.68;
      colors.push(light*.72,light*.89,light,light,light,light,light*.48,light*.64,light*.7);
    }
    i+=count;
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(vertices,3));
  geometry.setAttribute("color",new THREE.Float32BufferAttribute(colors,3));
  const material=new THREE.MeshBasicMaterial({vertexColors:true,transparent:true,opacity:.3,
    side:THREE.DoubleSide,depthWrite:false,toneMapped:false});
  group.add(new THREE.Mesh(geometry,material));
  return material;
};

export const createGlassWorld = (parent,image,reverseSlope,normalImage,pbrImage,fractureImage,edgeImage) => {
  const canvas=document.createElement("canvas");
  Object.assign(canvas.style,{position:"absolute",inset:"0",width:"1920px",height:"1080px",pointerEvents:"none"});
  parent.append(canvas);
  const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,preserveDrawingBuffer:true});
  renderer.setPixelRatio(1); renderer.setSize(1920,1080,false);
  renderer.setClearColor(0x000000,0); renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping; renderer.toneMappingExposure=.8;
  const scene=new THREE.Scene();
  const camera=new THREE.PerspectiveCamera(35,1920/1080,.1,100); camera.position.z=16;
  const room=new RoomEnvironment();
  const pmrem=new THREE.PMREMGenerator(renderer);
  const env=pmrem.fromScene(room,.04); scene.environment=env.texture;
  scene.environmentIntensity=.16;
  scene.add(new THREE.HemisphereLight(0xf5ffff,0x40505b,1.3));
  const lamp=new THREE.DirectionalLight(0xffffff,2.4); lamp.position.set(-4,6,8); scene.add(lamp);
  const textures=[photoTexture(image,fractureImage,edgeImage,true,reverseSlope),photoTexture(image,fractureImage,edgeImage,false,reverseSlope)];
  const normals=new THREE.Texture(normalImage); normals.needsUpdate=true;
  const pbr=new THREE.Texture(pbrImage); pbr.needsUpdate=true;
  const photographs=textures.map(texture=>new THREE.MeshBasicMaterial({map:texture.photo,side:THREE.DoubleSide,toneMapped:false}));
  const fractures=textures.map(texture=>new THREE.MeshBasicMaterial({color:0xaaaaaa,map:texture.fracture,side:THREE.DoubleSide,
    transparent:true,depthWrite:false,toneMapped:false,blending:THREE.CustomBlending,
    blendSrc:THREE.OneFactor,blendDst:THREE.OneMinusSrcColorFactor,blendEquation:THREE.AddEquation}));
  const face=new THREE.MeshPhysicalMaterial({color:0xffffff,metalness:.12,metalnessMap:pbr,roughness:.08,transmission:1,ior:1.5,
    thickness:.18,normalMap:normals,normalScale:new THREE.Vector2(.55,.55),envMapIntensity:.28,side:THREE.DoubleSide});
  face.onBeforeCompile=shader=>{
    shader.fragmentShader=shader.fragmentShader.replace("#include <metalnessmap_fragment>",
      "#include <metalnessmap_fragment>\nmetalnessFactor *= 1.0-smoothstep(0.055,0.14,abs(vMetalnessMapUv.y-0.5));");
  };
  const fractureFace=new THREE.MeshPhysicalMaterial({color:0xe1f0ed,metalness:.06,roughness:.08,
    transmission:.9,ior:1.5,thickness:.16,flatShading:true,side:THREE.DoubleSide});
  const edgeMaterials=[];
  const parts=[true,false].map(top=>{
    const {shape,edge}=makeShape(top,reverseSlope);
    const group=new THREE.Group();
    const photoGeo=imageGeometry(shape);
    if (top) {
      const shadow=new THREE.Mesh(photoGeo,new THREE.MeshBasicMaterial({color:0x000000,transparent:true,opacity:.34,depthWrite:false,side:THREE.DoubleSide}));
      shadow.position.set(.07,-.12,-.22); group.add(shadow);
    }
    const photo=new THREE.Mesh(photoGeo,photographs[top?0:1]); photo.position.z=-.018; group.add(photo);
    const solid=new THREE.ExtrudeGeometry(shape,{steps:1,depth:.28,bevelEnabled:true,bevelThickness:.035,bevelSize:.03,bevelSegments:2,curveSegments:1});
    const pos=solid.attributes.position,uv=solid.attributes.uv;
    for(let i=0;i<pos.count;i++)uv.setXY(i,(pos.getX(i)+HALF_W)/(HALF_W*2),(pos.getY(i)+HALF_H)/(HALF_H*2));
    uv.needsUpdate=true;
    const glass=new THREE.Mesh(solid,[face,fractureFace]); group.add(glass);
    const fracture=new THREE.Mesh(photoGeo,fractures[top?0:1]);
    fracture.position.z=.33; group.add(fracture);
    edgeMaterials.push(addEdgeFacets(group,edge,top));
    addFineCracks(group,edge,top);
    // Keep the upper pane in front without enlarging it so much that the
    // two halves of the same picture appear unrelated.
    group.position.z=top?.38:-.22;
    scene.add(group);
    return group;
  });
  // Very small splinters accompany the impact; the two large pieces remain
  // the only image-bearing panes. Fixed values keep every seek deterministic.
  const splinters=new THREE.Group(); scene.add(splinters);
  const shardMaterials=[];
  for(let i=0;i<20;i++) {
    const seed=(n)=>{const v=Math.sin((i+2)*42.37+n*17.29)*43827.73;return v-Math.floor(v);};
    const w=.045+seed(1)*.13,h=.025+seed(2)*.10;
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute("position",new THREE.Float32BufferAttribute([0,h,0,-w,-h*.55,0,w*.7,-h,0],3));
    const material=new THREE.MeshBasicMaterial({color:i%4===0?0x9bbec2:0xe3f7f5,transparent:true,opacity:0,side:THREE.DoubleSide,depthWrite:false,toneMapped:false});
    const shard=new THREE.Mesh(geometry,material);
    shard.userData={x:(seed(3)-.5)*17,y:(seed(4)-.5)*.60,vx:(seed(5)-.5)*1.6,vy:(seed(6)-.5)*1.05,spin:(seed(7)-.5)*4};
    splinters.add(shard); shardMaterials.push(material);
  }
  return {
    draw({x,direction,local,motionProgress}) {
      parts.forEach((part,index)=>{
        const sign=index===0?1:-1;
        part.position.x=(x*sign+direction*sign*.26/pxToWorld)*pxToWorld;
        part.position.y=index===0?-.16:.09;
        part.rotation.y=direction*sign*(3-1.5*motionProgress)*Math.PI/180;
        part.rotation.x=(index===0?-.18:.12);
        // Match the established opener's opposed image motion: top pushes
        // in, bottom pulls out; both shift toward the seam independently.
        const zoom=index===0 ? 1+(.035/1.18)*motionProgress : 1-(.03/1.20)*motionProgress;
        const dx=direction*sign*-(index===0?34:32)*motionProgress;
        const dy=sign*14*motionProgress;
        const photo=textures[index].photo;
        photo.repeat.set(1/zoom,1/zoom);
        photo.offset.set(-dx/(1920*zoom),dy/(1080*zoom));
      });
      const shardAge=Math.max(0,(local-5)/19);
      splinters.visible=local>=5&&local<24;
      splinters.children.forEach((shard,i)=>{
        const d=shard.userData;
        shard.position.set(d.x+d.vx*shardAge,d.y+d.vy*shardAge,2.1+i*.002);
        shard.rotation.z=d.spin*shardAge;
        shard.material.opacity=.8*(1-shardAge);
      });
      renderer.render(scene,camera);
    },
    dispose() {
      scene.traverse(obj=>{if(obj.geometry)obj.geometry.dispose();});
      photographs.forEach(material=>material.dispose()); fractures.forEach(material=>material.dispose());
      textures.forEach(texture=>{texture.photo.dispose();texture.fracture.dispose();});
      shardMaterials.forEach(material=>material.dispose()); edgeMaterials.forEach(material=>material.dispose());
      face.dispose(); fractureFace.dispose(); normals.dispose(); pbr.dispose();
      env.dispose(); pmrem.dispose(); room.dispose(); renderer.dispose(); canvas.remove();
    }
  };
};
