import {mat4} from '/js/gl-matrix-3.4.1/index.js';
import {DOM, getIDs, removeFromParent} from '/js/util.js';
import {GLUtil} from '/js/gl-util.js';
import {Mouse3D} from '/js/mouse3d.js';

//shitty new system because how do you call import() blocking
import {makePingPong} from '/js/gl-util-PingPong.js';
import {makeUnitQuad} from '/js/gl-util-UnitQuad.js';

const ids = getIDs();
window.ids = ids;

const urlparams = new URLSearchParams(location.search);

let canvas;
let gl;
let glutil;
let mouse;
let pingpong;
let grad;
let updateShader, displayShader;

const _G = {};

let modulo = 4;
_G.initValue = 1<<16;
_G.drawValue = 25;
let gridsize = +urlparams.get('size');
if (!gridsize || !isFinite(gridsize)) gridsize = 1024;

let inputMethod = document.querySelector('input[name="inputMethod"]:checked').value;

let bufferCPU = new Uint8Array(4 * gridsize * gridsize);

let colors = [
	[0,0,0],
	[0,255,255],
	[255,255,0],
	[255,0,0]
];

let totalSand = 0;
	
function setTotalSand(newTotalSand) {
	totalSand = newTotalSand;
	ids.totalSand.innerText = ''+totalSand;
}

function reset() {
	bufferCPU.fill();
	bufferCPU[0 + 4 * ((gridsize>>1) + gridsize * (gridsize>>1))] = _G.initValue & 0xff;
	bufferCPU[1 + 4 * ((gridsize>>1) + gridsize * (gridsize>>1))] = (_G.initValue >> 8) & 0xff;
	bufferCPU[2 + 4 * ((gridsize>>1) + gridsize * (gridsize>>1))] = (_G.initValue >> 16) & 0xff;
	bufferCPU[3 + 4 * ((gridsize>>1) + gridsize * (gridsize>>1))] = (_G.initValue >> 24) & 0xff;

	pingpong.history.forEach(h => {
		h.bind();
		//will the pointer type cast be allowed?
		//or will I have to reshape the int32 data into uint8 x4 data?
		gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gridsize, gridsize, gl.RGBA, gl.UNSIGNED_BYTE, bufferCPU);
		h.unbind();
	});

	setTotalSand(_G.initValue);
}
//can't declare _G.<function> if _G is decared const, because javascript ...
// even tho const means _G's ref is immutable, but not _G's contents .... 
// smh javascript
_G.reset = reset;

function initGL() {
	gl.clearColor(.2, .2, .2, 1);

	pingpong = new glutil.PingPong({
		width : gridsize,
		height : gridsize,
		internalFormat : gl.RGBA8,
		format : gl.RGBA,
		type : gl.UNSIGNED_BYTE,
		minFilter : gl.NEAREST,
		magFilter : gl.NEAREST,
		wrap : {
			s : gl.REPEAT,
			t : gl.REPEAT
		}
	});
	pingpong.fbo.bind();
	pingpong.fbo.unbind();
	_G.reset();

	grad = new glutil.Texture2D({
		width : modulo,
		height : 1,
		internalFormat : gl.RGB,
		format : gl.RGB,
		type : gl.UNSIGNED_BYTE,
		minFilter : gl.NEAREST,
		magFilter : gl.NEAREST,
		wrap : {
			s : gl.REPEAT,
			t : gl.REPEAT
		},
		data : new Uint8Array([].concat.apply([], colors))
	});
	grad.bind(1);

	let glstr = function(x) {
		let s = ''+x;
		if (s.indexOf('.') == -1) s += '.';
		return s;
	};

	updateShader = new glutil.Program({
		vertexCode : `
in vec2 vertex;
uniform mat4 projMat, mvMat;
out vec2 tc;
void main() {
	tc = vertex.st;
	gl_Position = projMat * mvMat * vec4(vertex, 0., 1.);
}
`,
		fragmentCode : `
const float du = `+glstr(1/gridsize)+`;
const float modulo = `+glstr(modulo)+`;

in vec2 tc;
uniform sampler2D tex;

//divide by modulo
vec4 fixedShift(vec4 v) {
	vec4 r = mod(v, modulo / 256.);
	v -= r;	//remove lower bits
	v /= modulo;	//perform fixed division
	v.rgb += r.gba * (256. / modulo);	//add the remainder lower bits
	return v;
}

out vec4 fragColor;
void main() {
	vec4 last = texture(tex, tc);
	
	//sum neighbors
	vec4 next = fixedShift(texture(tex, tc + vec2(du, 0)))
		+ fixedShift(texture(tex, tc + vec2(-du, 0)))
		+ fixedShift(texture(tex, tc + vec2(0, du)))
		+ fixedShift(texture(tex, tc + vec2(0, -du)));

	//add last cell modulo
	next.r += mod(last.r, modulo / 256.);
	
	//addition with overflow
	next.g += floor(next.r) / 256.;
	next.b += floor(next.g) / 256.;
	next.a += floor(next.b) / 256.;
	next = mod(next, 1.);
	fragColor = next;
}
`,
		uniforms : {
			tex : 0
		}
	});

	displayShader = new glutil.Program({
		vertexCode : `
in vec2 vertex;
uniform mat4 projMat, mvMat;
out vec2 tc;
void main() {
	tc = vertex;
	gl_Position = projMat * mvMat * vec4(vertex, 0., 1.);
}
`,
		fragmentCode : `
const float modulo = `+modulo+`.;
in vec2 tc;
uniform sampler2D tex, grad;
out vec4 fragColor;
void main() {
	vec3 toppleColor = texture(tex, tc).rgb;
	float value = toppleColor.r * (256. / modulo);
	fragColor = texture(grad, vec2(value + (.5 / modulo), .5));
}
`,
		uniforms : {
			tex : 0,
			grad : 1
		}
	});
}

let lastX = undefined;
let lastY = undefined;
function update() {
	glutil.draw();

	//TODO just draw a 1x1 quad over the correct pixel
	if (inputMethod == 'draw' && mouse.isDown) {
		let ar = canvas.width / canvas.height;
		let thisX = (mouse.xf - .5) * 2 * glutil.view.fovY * ar + glutil.view.pos[0];
		let thisY = (1 - mouse.yf - .5) * 2 * glutil.view.fovY + glutil.view.pos[1];
		thisX = Math.floor(thisX * gridsize + .5);
		thisY = Math.floor(thisY * gridsize + .5);
		if (lastX === undefined) lastX = thisX;
		if (lastY === undefined) lastY = thisY;

		let dx = thisX - lastX;
		let dy = thisY - lastY;
		let d = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), 1));

		for (let i = .5; i <= d; ++i) {
			let f = i / d;
			let _f = 1 - f;
			let x = _f * thisX + f * lastX;
			let y = _f * thisY + f * lastY;
		
			if (x >= 0 && x < gridsize && y >= 0 && y < gridsize) {
				let value = new Uint8Array(4);
				pingpong.draw({
					callback : function() {
						gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, value);
					}
				});
				let intvalue = value[0] | (value[1] << 8) | (value[2] << 16) | (value[3] << 24);
				intvalue += _G.drawValue;
				value[0] = intvalue & 0xff;
				value[1] = (intvalue >> 8) & 0xff;
				value[2] = (intvalue >> 16) & 0xff;
				value[3] = (intvalue >> 24) & 0xff;
				
				pingpong.current().bind();
				gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, value)
				pingpong.current().unbind();
				setTotalSand(totalSand + _G.drawValue);
			}
		}

		lastX = thisX;
		lastY = thisY;
	}

	let fboProjMat = mat4.create();
	mat4.identity(fboProjMat);
	mat4.ortho(fboProjMat, 0, 1, 0, 1, -1, 1);
	let fboMvMat = mat4.create();
	mat4.identity(fboMvMat);

	pingpong.swap();
	pingpong.draw({
		viewport : [0,0,gridsize,gridsize],
		callback : function() {
			glutil.UnitQuad.unitQuad.draw({
				shader : updateShader,
				texs : [pingpong.previous()],
				uniforms : {
					projMat : fboProjMat,
					mvMat : fboMvMat 
				}
			});
		},
	});
	
	glutil.UnitQuad.unitQuad.draw({
		shader : displayShader,
		texs : [pingpong.current()]
	});

	requestAnimationFrame(update);
	//setTimeout(update, 0);
}

canvas = DOM('canvas', {
	css : {
		left : 0,
		top : 0,
		position : 'absolute',
		userSelect : 'none',
	},
	prependTo : document.body,
});

try {
	glutil = new GLUtil({
		canvas : canvas,
		fullscreen : true
	});
	gl = glutil.context;
} catch (e) {
	removeFromParent(canvas);
	throw e;
}
glutil.import('PingPong', makePingPong);
glutil.import('UnitQuad', makeUnitQuad);

mouse = new Mouse3D({
	pressObj : canvas,
	move : function(dx,dy) {
		if (inputMethod == 'pan') {
			glutil.view.pos[0] -= dx / canvas.height * 2 * glutil.view.fovY;
			glutil.view.pos[1] += dy / canvas.height * 2 * glutil.view.fovY;
			glutil.updateProjection();
		} 
	},
	zoom : function(dz) {
		glutil.view.fovY *= Math.exp(-.1 * dz / canvas.height);
		glutil.updateProjection();
	},
	mousedown : function() {
		lastX = undefined;
		lastY = undefined;
	}
});

glutil.view.ortho = true;
glutil.view.zNear = -1;
glutil.view.zFar = 1;
glutil.view.fovY = .5;
glutil.view.pos[0] = .5;
glutil.view.pos[1] = .5;
glutil.updateProjection();

let maxsize =  gl.getParameter(gl.MAX_TEXTURE_SIZE);
if (gridsize > maxsize) gridsize = maxsize;
for (let size = 32; size <= maxsize; size<<=1) {
	let option = DOM('option', {
		text : size,
		value : size,
		appendTo : ids.gridsize,
	});
	if (size == gridsize) option.setAttribute('selected', 'true');
}
ids.gridsize.addEventListener('change', e => {
	const params = new URLSearchParams(urlparams);
	params.set('size', ids.gridsize.value);
	location.href = location.origin + location.pathname + '?' + params.toString();
});

['reset'].forEach(field => {
	ids[field].addEventListener('click', e => {
		_G[field]();
	});
});

['initValue', 'drawValue'].forEach(field => {
	const o = ids[field];
	o.value = _G[field];
	o.addEventListener('change', e => {
		_G[field] = +o.value;
	});
});

// TODO here and conway-life-webgl a better way ...
let updateRadio = function() {
	for (let k in ids) {
		if (k.substr(0,11) == 'inputMethod') {
			ids[k].checked = ids[k].value == inputMethod;
		}
	}
};
ids.inputMethod_pan.addEventListener('click', e => { inputMethod = 'pan'; });
ids.inputMethod_draw.addEventListener('click', e => { inputMethod = 'draw'; });
ids.button_pan.addEventListener('click', e => { inputMethod = 'pan'; updateRadio(); });
ids.button_draw.addEventListener('click', e => { inputMethod = 'draw'; updateRadio(); });

initGL();
update();
