var canvas;
var gl;
var glutil;

var modulo = 4;
var initValue = 1<<16;
var drawValue = 25;
var gridsize = +$.url().param('size');
if (gridsize !== gridsize) gridsize = 1024;

var inputMethod = 'pan';

var bufferCPU = new Uint8Array(4 * gridsize * gridsize);

var colors = [
	[0,0,0],
	[0,255,255],
	[255,255,0],
	[255,0,0]
];

var totalSand = 0;
	
function setTotalSand(newTotalSand) {
	totalSand = newTotalSand;
	$('#totalSand').text(''+totalSand);
}

function reset() {
	bufferCPU.fill();
	bufferCPU[0 + 4 * ((gridsize>>1) + gridsize * (gridsize>>1))] = initValue & 0xff;
	bufferCPU[1 + 4 * ((gridsize>>1) + gridsize * (gridsize>>1))] = (initValue >> 8) & 0xff;
	bufferCPU[2 + 4 * ((gridsize>>1) + gridsize * (gridsize>>1))] = (initValue >> 16) & 0xff;
	bufferCPU[3 + 4 * ((gridsize>>1) + gridsize * (gridsize>>1))] = (initValue >> 24) & 0xff;

	$.each(pingpong.history, function(i,h) {
		h.bind();
		//will the pointer type cast be allowed?
		//or will I have to reshape the int32 data into uint8 x4 data?
		gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gridsize, gridsize, gl.RGBA, gl.UNSIGNED_BYTE, bufferCPU);
		h.unbind();
	});

	setTotalSand(initValue);
}

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
	reset();

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

	var glstr = function(x) {
		var s = ''+x;
		if (s.indexOf('.') == -1) s += '.';
		return s;
	};

	updateShader = new glutil.ShaderProgram({
		vertexPrecision : 'best',
		vertexCode : mlstr(function(){/*
attribute vec2 vertex;
uniform mat4 projMat, mvMat;
varying vec2 tc;
void main() {
	tc = vertex.st;
	gl_Position = projMat * mvMat * vec4(vertex, 0., 1.);
}
*/}),
		fragmentPrecision : 'best',
		fragmentCode : 
		
'const float du = '+glstr(1/gridsize)+';\n'+
'const float modulo = '+glstr(modulo)+';\n'+
mlstr(function(){/*
varying vec2 tc;
uniform sampler2D tex;

//divide by modulo
vec4 fixedShift(vec4 v) {
	vec4 r = mod(v, modulo / 256.);
	v -= r;	//remove lower bits
	v /= modulo;	//perform fixed division
	v.rgb += r.gba * (256. / modulo);	//add the remainder lower bits
	return v;
}

void main() {
	vec4 last = texture2D(tex, tc);
	
	//sum neighbors
	vec4 next = fixedShift(texture2D(tex, tc + vec2(du, 0)))
		+ fixedShift(texture2D(tex, tc + vec2(-du, 0)))
		+ fixedShift(texture2D(tex, tc + vec2(0, du)))
		+ fixedShift(texture2D(tex, tc + vec2(0, -du)));

	//add last cell modulo
	next.r += mod(last.r, modulo / 256.);
	
	//addition with overflow
	next.g += floor(next.r) / 256.;
	next.b += floor(next.g) / 256.;
	next.a += floor(next.b) / 256.;
	next = mod(next, 1.);
	gl_FragColor = next;
}
*/}),
		uniforms : {
			tex : 0
		}
	});

	displayShader = new glutil.ShaderProgram({
		vertexPrecision : 'best',
		vertexCode : mlstr(function(){/*
attribute vec2 vertex;
uniform mat4 projMat, mvMat;
varying vec2 tc;
void main() {
	tc = vertex;
	gl_Position = projMat * mvMat * vec4(vertex, 0., 1.);
}
*/}),
		fragmentPrecision : 'best',
		fragmentCode : 
'const float modulo = '+modulo+'.;\n'
+mlstr(function(){/*
varying vec2 tc;
uniform sampler2D tex, grad;
void main() {
	vec3 toppleColor = texture2D(tex, tc).rgb;
	float value = toppleColor.r * (256. / modulo);
	gl_FragColor = texture2D(grad, vec2(value + (.5 / modulo), .5));
}
*/}),
		uniforms : {
			tex : 0,
			grad : 1
		}
	});
}

var lastX = undefined;
var lastY = undefined;
function update() {
	glutil.draw();

	//TODO just draw a 1x1 quad over the correct pixel
	if (inputMethod == 'draw' && mouse.isDown) {
		var ar = canvas.width / canvas.height;
		var thisX = (mouse.xf - .5) * 2 * glutil.view.fovY * ar + glutil.view.pos[0];
		var thisY = (1 - mouse.yf - .5) * 2 * glutil.view.fovY + glutil.view.pos[1];
		thisX = Math.floor(thisX * gridsize + .5);
		thisY = Math.floor(thisY * gridsize + .5);
		if (lastX === undefined) lastX = thisX;
		if (lastY === undefined) lastY = thisY;

		var dx = thisX - lastX;
		var dy = thisY - lastY;
		var d = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), 1));

		for (var i = .5; i <= d; ++i) {
			var f = i / d;
			var _f = 1 - f;
			var x = _f * thisX + f * lastX;
			var y = _f * thisY + f * lastY;
		
			if (x >= 0 && x < gridsize && y >= 0 && y < gridsize) {
				var value = new Uint8Array(4);
				pingpong.draw({
					callback : function() {
						gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, value);
					}
				});
				var intvalue = value[0] | (value[1] << 8) | (value[2] << 16) | (value[3] << 24);
				intvalue += drawValue;
				value[0] = intvalue & 0xff;
				value[1] = (intvalue >> 8) & 0xff;
				value[2] = (intvalue >> 16) & 0xff;
				value[3] = (intvalue >> 24) & 0xff;
				
				pingpong.current().bind();
				gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, value)
				pingpong.current().unbind();
				setTotalSand(totalSand + drawValue);
			}
		}

		lastX = thisX;
		lastY = thisY;
	}

	var fboProjMat = mat4.create();
	mat4.identity(fboProjMat);
	mat4.ortho(fboProjMat, 0, 1, 0, 1, -1, 1);
	var fboMvMat = mat4.create();
	mat4.identity(fboMvMat);

	pingpong.swap();
	pingpong.draw({
		viewport : [0,0,gridsize,gridsize],
		callback : function() {
			glutil.unitQuad.draw({
				shader : updateShader,
				texs : [pingpong.previous()],
				uniforms : {
					projMat : fboProjMat,
					mvMat : fboMvMat 
				}
			});
		},
	});
	
	glutil.unitQuad.draw({
		shader : displayShader,
		texs : [pingpong.current()]
	});

	//requestAnimFrame(update);
	setTimeout(update, 0);
}

$(document).ready(function(){
	canvas = $('<canvas>', {
		css : {
			left : 0,
			top : 0,
			position : 'absolute'
		}
	}).prependTo(document.body).get(0);
	$(canvas).disableSelection()

	try {
		glutil = new GLUtil({
			canvas : canvas,
			fullscreen : true
		});
		gl = glutil.context;
	} catch (e) {
		$(canvas).remove(); throw e;
	}

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

	var maxsize =  gl.getParameter(gl.MAX_TEXTURE_SIZE);
	if (gridsize > maxsize) gridsize = maxsize;
	var gridsizes = $('#gridsize');
	for (var size = 32; size <= maxsize; size<<=1) {
		var option = $('<option>', {
			text : size,
			value : size
		});
		if (size == gridsize) option.attr('selected', 'true');
		gridsizes.append(option);
	}
	gridsizes.change(function() {
		var params = $.url().param();
		params.size = gridsizes.val();
		var url = location.href.match('[^?]*')[0];
		var sep = '?';
		for (k in params) {
			if (k != '') {
				url += sep;
				url += k + '=' + params[k];
				sep = '&';
			}
		}
		location.href = url;
	});

	$.each(['reset'], function(i, field) {
		$('#'+field).click(function() {
			window[field]();
		});
	});

	$.each(['initValue', 'drawValue'], function(i, field) {
		$('#'+field)
			.val(''+window[field])
			.change(function() {
				window[field] = +$(this).val();
			});
	});

	//https://stackoverflow.com/questions/4618733/set-selected-radio-from-radio-group-with-a-value#4618748
	var updateRadio = function() { $('input[name=inputMethod]').val([inputMethod]); };
	$('#inputMethod_pan').click(function() { inputMethod = 'pan'; });
	$('#inputMethod_draw').click(function() { inputMethod = 'draw'; });
	$('#button_pan').click(function() { inputMethod = 'pan'; updateRadio(); });
	$('#button_draw').click(function() { inputMethod = 'draw'; updateRadio(); });

	initGL();
	update();
});
