
(function(){
  var c=document.getElementById("bg"); if(!c) return;
  window.EH_BG=window.EH_BG||{skip:1};
  var fallback="radial-gradient(circle at 50% 44%,#000 0 6%,#ffb25a 7.5%,#7a2a6e 16%,#14102e 38%,#05040d 70%)";
  var gl=null; try{ gl=c.getContext("webgl",{antialias:false,alpha:false,powerPreference:"low-power"})||c.getContext("experimental-webgl"); }catch(e){}
  if(!gl){ c.style.background=fallback; return; }
  var VS="attribute vec2 a;void main(){gl_Position=vec4(a,0.0,1.0);}";
  var FS=[
  "precision highp float;",
  "uniform vec2 R;uniform float T;",
  "float h21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}",
  "float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);",
  " return mix(mix(h21(i),h21(i+vec2(1.0,0.0)),f.x),mix(h21(i+vec2(0.0,1.0)),h21(i+vec2(1.0,1.0)),f.x),f.y);}",
  "float fbm(vec2 p){float a=0.5,s=0.0;for(int i=0;i<4;i++){s+=a*vn(p);p=p*2.03+vec2(11.7,3.1);a*=0.5;}return s;}",
  "vec3 stars(vec2 p){",
  " vec3 c=vec3(0.0);",
  " for(int l=0;l<3;l++){",
  "  float fl=float(l);",
  "  float sc=38.0+fl*52.0;",
  "  vec2 q=p*sc+fl*17.3;",
  "  vec2 id=floor(q);",
  "  vec2 f=fract(q)-0.5;",
  "  float r=h21(id+fl*3.7);",
  "  vec2 off=(vec2(h21(id+3.1),h21(id+7.7))-0.5)*0.6;",
  "  float d=length(f-off);",
  "  float s=smoothstep(0.09,0.0,d)*step(0.84,r);",
  "  vec3 tint=mix(vec3(0.7,0.8,1.0),vec3(1.0,0.85,0.7),h21(id+1.9));",
  "  c+=s*tint*(0.55+0.45*sin(T*(0.8+2.5*r)+r*60.0));",
  " }",
  " return c;",
  "}",
  "void main(){",
  " float sz=min(R.y,R.x*1.3);",
  " vec2 p=(gl_FragCoord.xy-0.5*R)/sz-vec2(0.0,0.06);",
  " float rs=0.105;",
  " float r=length(p);",
  " vec2 dir=p/max(r,0.0005);",
  " float bend=rs*rs*3.0/max(r,rs*0.95);",
  " vec2 sp=p-dir*bend;",
  " vec3 col=stars(sp+vec2(T*0.003,0.0));",
  " col+=vec3(0.07,0.025,0.13)*fbm(sp*2.6+vec2(0.0,T*0.01))*(1.0-smoothstep(0.0,0.95,r))*1.4;",
  " float tilt=0.26;",
  " vec2 dp=vec2(p.x,p.y/tilt);",
  " float dr=length(dp);",
  " float rin=rs*1.6;float rout=rs*5.4;",
  " float band=smoothstep(rin,rin+rs*0.25,dr)*(1.0-smoothstep(rout*0.55,rout,dr));",
  " float ang=atan(dp.y,dp.x)-T*0.45*pow(rs/max(dr,0.01),1.5);",
  " vec2 q=vec2(cos(ang),sin(ang))*dr/rs*1.8;",
  " float tex=0.35+1.2*fbm(q*1.3)+0.5*fbm(q*4.0);",
  " float inten=band*tex*pow(rs/max(dr,0.01),0.9)*2.6;",
  " float dop=1.0-0.7*dp.x/max(dr,0.01);",
  " inten*=dop*dop;",
  " vec3 dc=mix(vec3(1.0,0.93,0.75),vec3(1.0,0.32,0.05),smoothstep(rin,rout*0.75,dr));",
  " vec3 disk=dc*inten;",
  " float hv=0.25+0.75*pow(abs(p.y)/max(r,0.0005),0.8);",
  " float halo=exp(-pow((r-rs*1.10)/(rs*0.16),2.0));",
  " float halo2=exp(-pow((r-rs*1.55)/(rs*0.55),2.0));",
  " float side=0.8+0.25*(1.0-0.7*p.x/max(r,0.0005));",
  " vec3 hc=(vec3(1.0,0.78,0.45)*halo*1.5+vec3(1.0,0.45,0.15)*halo2*0.45)*hv*side;",
  " vec3 back=(dp.y>0.0)?disk:vec3(0.0);",
  " vec3 front=(dp.y<=0.0)?disk:vec3(0.0);",
  " col+=back+hc;",
  " col*=1.0-smoothstep(rs,rs*0.96,r);",
  " col+=front;",
  " col+=vec3(1.0,0.5,0.2)*0.035*exp(-r*r/0.05);",
  " col=1.0-exp(-col*1.25);",
  " col*=1.0-0.5*smoothstep(0.35,1.0,r);",
  " gl_FragColor=vec4(col,1.0);",
  "}"
  ].join("\n");
  function sh(t,s){var o=gl.createShader(t);gl.shaderSource(o,s);gl.compileShader(o);return gl.getShaderParameter(o,gl.COMPILE_STATUS)?o:null;}
  var v=sh(gl.VERTEX_SHADER,VS), f=sh(gl.FRAGMENT_SHADER,FS);
  var pr=gl.createProgram();
  if(!v||!f){ c.style.background=fallback; return; }
  gl.attachShader(pr,v);gl.attachShader(pr,f);gl.linkProgram(pr);
  if(!gl.getProgramParameter(pr,gl.LINK_STATUS)){ c.style.background=fallback; return; }
  gl.useProgram(pr);
  var b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
  var loc=gl.getAttribLocation(pr,"a");gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
  var uR=gl.getUniformLocation(pr,"R"),uT=gl.getUniformLocation(pr,"T");
  var still=window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches;
  var t0=performance.now(),n=0;
  function size(){
    var d=Math.min(window.devicePixelRatio||1,1.5)*0.7;
    c.width=Math.max(2,Math.floor(innerWidth*d));c.height=Math.max(2,Math.floor(innerHeight*d));
    gl.viewport(0,0,c.width,c.height);
    if(still) draw(0,true);
  }
  function draw(now,force){
    if(!force&&!still) requestAnimationFrame(draw);
    if(!force&&document.hidden) return;
    var sk=window.EH_BG.skip||1;
    if(!force&&(n++%sk)!==0) return;
    gl.uniform2f(uR,c.width,c.height);
    gl.uniform1f(uT,still?24:((now-t0)/1000+20));
    gl.drawArrays(gl.TRIANGLES,0,3);
  }
  addEventListener("resize",size);
  size();
  if(!still) requestAnimationFrame(draw);
})();
