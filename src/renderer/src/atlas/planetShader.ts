// Procedural surfaces from the approved planet study. Spherical noise has no UV seam.
export const PLANET_FRAGMENT = `
precision highp float;
uniform vec2 resolution;
uniform float clockTime, seed, family, atmosphere, scale;
float hash(vec3 p){p=fract(p*.3183099+vec3(.13,.37,.71));p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float noise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
float fbm(vec3 p){float v=0.,a=.52;for(int i=0;i<5;i++){v+=noise(p)*a;p=p*2.03+vec3(8.2,1.7,3.5);a*=.49;}return v;}
vec3 turn(vec3 p,float a){float c=cos(a),s=sin(a);return vec3(c*p.x+s*p.z,p.y,-s*p.x+c*p.z);}
void main(){
 vec2 uv=(gl_FragCoord.xy-resolution*.5)/min(resolution.x,resolution.y)*2.;uv/=scale*.72;
 float rr=dot(uv,uv), r=sqrt(rr);vec3 atmosphereColor=vec3(.24,.49,.78);
 if(family>1.5&&family<2.5)atmosphereColor=vec3(.60,.39,.26);
 if(family>3.5&&family<4.5)atmosphereColor=vec3(.84,.25,.075);
 if(family>4.5)atmosphereColor=vec3(.48,.42,.65);
 if(rr>1.){float glow=exp(-(r-1.)*36.)*.16*atmosphere;float sunward=clamp(.6-.3*uv.x+.3*uv.y,0.,1.);gl_FragColor=vec4(atmosphereColor,glow*sunward);return;}
 vec3 n=vec3(uv,sqrt(1.-rr)),p=turn(n,clockTime*.024+seed*.031);
 vec3 base=vec3(.15);float rough=0.,ocean=0.,clouds=0.;
 vec3 q=p*3.+vec3(seed*.139,seed*.073,seed*.017);
 float terrain=fbm(q+vec3(fbm(q*1.7),fbm(q*1.7+17.),fbm(q*1.7+31.))*.65);
 if(family<.5){
  ocean=1.-smoothstep(.47,.51,terrain);base=mix(vec3(.018,.082,.115),vec3(.035,.18,.24),smoothstep(.36,.49,terrain));
  vec3 land=mix(vec3(.13,.19,.12),vec3(.41,.37,.25),smoothstep(.51,.64,terrain));land=mix(land,vec3(.78,.80,.73),smoothstep(.72,.87,abs(p.y)+terrain*.13));
  base=mix(land,base,ocean);rough=terrain;
 }else if(family<1.5){
  float warp=fbm(q*2.+vec3(clockTime*.016,0,0));
  float bands=sin(p.y*58.+warp*10.+sin(p.x*9.+p.z*5.)*.8);
  float fine=fbm(q*12.);float storm=length((p.xy-vec2(.32,-.19))*vec2(1.,2.4));
  float swirl=sin(storm*57.+atan(p.y+.19,p.x-.32)*2.+warp*8.);
  bands=mix(bands,swirl,(1.-smoothstep(.12,.37,storm))*.85);
  base=mix(vec3(.25,.18,.135),vec3(.78,.69,.53),smoothstep(-.8,.8,bands));base*=.80+fine*.4;rough=warp;
 }else if(family<2.5){
  float ridges=abs(sin(terrain*27.+fbm(q*7.)*2.));
  base=mix(vec3(.20,.105,.058),vec3(.66,.43,.24),terrain);base+=pow(ridges,12.)*.075;rough=fbm(q*15.);
  base=mix(base,vec3(.72,.67,.53),smoothstep(.85,.98,abs(p.y)));
 }else if(family<3.5){
  float veins=abs(fbm(q*3.)-.48);float cracks=1.-smoothstep(.006,.024,veins);
  base=mix(vec3(.25,.39,.43),vec3(.75,.84,.81),terrain);base=mix(base,vec3(.07,.18,.23),cracks*.63);rough=fbm(q*13.);
 }else if(family<4.5){
  float crack=1.-smoothstep(.012,.045,abs(terrain-.5));
  base=mix(vec3(.055,.045,.046),vec3(.19,.16,.14),fbm(q*15.));base+=vec3(1.,.20,.025)*crack*.50;rough=fbm(q*17.);
 }else{
  vec3 w=q+vec3(fbm(q*2.),fbm(q*2.+9.),fbm(q*2.+21.))*1.6;
  float whorls=fbm(w*3.+vec3(clockTime*.022,0,0));
  base=mix(vec3(.14,.16,.26),vec3(.60,.65,.75),smoothstep(.28,.70,whorls));base=mix(base,vec3(.49,.39,.43),smoothstep(.53,.64,whorls)*.35);rough=whorls;
 }
 vec3 light=normalize(vec3(-.65,.48,1.));float day=max(dot(n,light),0.);
 if(family<.5||family>1.5&&family<3.5){
  vec3 cp=turn(n,clockTime*.035+seed*.031)*5.+vec3(seed*.139,seed*.073,seed*.017);
  float c=fbm(cp+vec3(fbm(cp*2.),fbm(cp*2.+5.),0.)*1.7);
  clouds=smoothstep(.49,.69,c)*atmosphere*(family<.5?1.:.3);base=mix(base,vec3(.87,.90,.92),clouds);
 }
 vec3 color=base*(.042+pow(day,.85)*1.05)*(1.+(rough-.5)*.19);
 float spec=pow(max(dot(reflect(-light,n),vec3(0,0,1)),0.),85.);color+=vec3(.80,.86,.81)*spec*ocean*(1.-clouds)*.53;
 if(family>3.5&&family<4.5)color+=vec3(.65,.085,.006)*(1.-smoothstep(.008,.025,abs(terrain-.5)))*.65;
 float rim=pow(1.-n.z,3.8);color+=atmosphereColor*rim*atmosphere*(.07+day*.65);
 color*=smoothstep(0.,.02,1.-rr);gl_FragColor=vec4(pow(max(color,vec3(0.)),vec3(.88)),1.);
}
`
