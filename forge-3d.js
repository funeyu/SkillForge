(() => {
  'use strict';

  const sceneElement = document.getElementById('scene');
  const viewport = document.getElementById('three-viewport');
  const loading = document.getElementById('scene-loading');
  const loadingText = document.getElementById('scene-loading-text');
  const retryButton = document.getElementById('retry-3d');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const sources = [
    './node_modules/three/build/three.module.js'
  ];
  let loadingEngine = false;
  let cachedEngine;
  let destroyScene;

  function showRendererError(message) {
    sceneElement.classList.remove('has-three');
    loading.hidden = false;
    loadingText.textContent = message;
    retryButton.hidden = false;
    sceneElement.dataset.renderer = 'error';
  }

  async function loadEngine() {
    if (cachedEngine) return cachedEngine;
    for (const source of sources) {
      let timeout;
      try {
        cachedEngine = await Promise.race([
          import(source),
          new Promise((resolve, reject) => {
            timeout = setTimeout(() => reject(new Error('3D engine load timed out')), 9000);
          })
        ]);
        return cachedEngine;
      } catch (error) {
        console.warn('[SkillForge 3D] Engine unavailable:', source, error.message);
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new Error('Unable to load Three.js');
  }

  function buildScene(THREE) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    const disposables = new Set();
    const geometries = new Map();
    const listeners = new AbortController();
    const world = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-7, 7, 4, -4, .1, 80);
    const model = new THREE.Group();
    const cameraTarget = new THREE.Vector3(0, 1.6, 0);
    let resizeObserver;
    let intersectionObserver;
    let disposed = false;
    let inView = true;
    let contextLost = false;
    let previousTimestamp = 0;
    let motionTime = 0;
    let celebrationTime = -1;
    let wasCompleted = false;
    let lastStrike = -1;
    let dragging = false;
    let pointerId = null;
    let pointerStart = { x: 0, y: 0 };
    let dragStartYaw = 0;
    let dragStartPitch = 0;
    let targetYaw = 0;
    let targetPitch = 0;
    let currentYaw = 0;
    let currentPitch = 0;
    let hoverYaw = 0;
    let hoverPitch = 0;

    const track = (resource) => { disposables.add(resource); return resource; };
    const geometry = (key, create) => {
      if (!geometries.has(key)) geometries.set(key, track(create()));
      return geometries.get(key);
    };
    destroyScene = dispose;
    const toonGradient = track(new THREE.DataTexture(new Uint8Array([
      110, 110, 110, 255, 170, 170, 170, 255, 218, 218, 218, 255, 255, 255, 255, 255
    ]), 4, 1, THREE.RGBAFormat));
    toonGradient.minFilter = toonGradient.magFilter = THREE.NearestFilter;
    toonGradient.generateMipmaps = false;
    toonGradient.needsUpdate = true;
    const material = (color, options = {}) => track(new THREE.MeshToonMaterial({ color, gradientMap: toonGradient, ...options }));
    const palette = {
      sage: material('#3e4148'),
      pale: material('#777d88'),
      dark: material('#25272d'),
      deep: material('#14151a'),
      cream: material('#b9bdc6'),
      brass: material('#b29479'),
      orange: material('#ec975f'),
      iron: material('#5d626c'),
      rubber: material('#141519'),
      wood: material('#303239'),
      ink: material('#0d0e11')
    };

    function roundedGeometry(width, height, depth, radius = .1) {
      const bevel = Math.min(.035, depth / 5, width / 8, height / 8);
      const halfWidth = width / 2 - bevel;
      const halfHeight = height / 2 - bevel;
      const corner = Math.min(radius, halfWidth, halfHeight);
      return geometry(`box:${width}:${height}:${depth}:${radius}`, () => {
        const shape = new THREE.Shape();
        shape.moveTo(-halfWidth + corner, -halfHeight);
        shape.lineTo(halfWidth - corner, -halfHeight);
        shape.quadraticCurveTo(halfWidth, -halfHeight, halfWidth, -halfHeight + corner);
        shape.lineTo(halfWidth, halfHeight - corner);
        shape.quadraticCurveTo(halfWidth, halfHeight, halfWidth - corner, halfHeight);
        shape.lineTo(-halfWidth + corner, halfHeight);
        shape.quadraticCurveTo(-halfWidth, halfHeight, -halfWidth, halfHeight - corner);
        shape.lineTo(-halfWidth, -halfHeight + corner);
        shape.quadraticCurveTo(-halfWidth, -halfHeight, -halfWidth + corner, -halfHeight);
        const result = new THREE.ExtrudeGeometry(shape, {
          depth: depth - bevel * 2,
          bevelEnabled: true,
          bevelThickness: bevel,
          bevelSize: bevel,
          bevelSegments: 2,
          curveSegments: 5,
          steps: 1
        });
        result.translate(0, 0, -depth / 2 + bevel);
        return result;
      });
    }

    function mesh(parent, meshGeometry, meshMaterial, position, castsShadow = true) {
      const object = new THREE.Mesh(meshGeometry, meshMaterial);
      object.position.set(...position);
      object.castShadow = castsShadow;
      object.receiveShadow = true;
      parent.add(object);
      return object;
    }

    function box(parent, width, height, depth, meshMaterial, position, radius = .1) {
      return mesh(parent, roundedGeometry(width, height, depth, radius), meshMaterial, position);
    }

    function cylinder(parent, radius, length, meshMaterial, position) {
      return mesh(parent, geometry(`cylinder:${radius}:${length}`, () => new THREE.CylinderGeometry(radius, radius, length, 20)), meshMaterial, position);
    }

    function sphere(parent, radius, meshMaterial, position) {
      return mesh(parent, geometry(`sphere:${radius}`, () => new THREE.SphereGeometry(radius, 12, 8)), meshMaterial, position, false);
    }

    function torus(parent, radius, tube, meshMaterial, position) {
      return mesh(parent, geometry(`torus:${radius}:${tube}`, () => new THREE.TorusGeometry(radius, tube, 8, 40)), meshMaterial, position);
    }

    function label(parent, text, width, height, position, options = {}) {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = Math.max(64, Math.round(512 * height / width));
      const context = canvas.getContext('2d');
      context.fillStyle = options.background || '#202126';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = options.color || '#e0e2e8';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.font = `700 ${Math.round(canvas.height * (options.fontScale || .53))}px ui-monospace, monospace`;
      context.fillText(text, 256, canvas.height * .52, 460);
      const texture = track(new THREE.CanvasTexture(canvas));
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      const labelMaterial = material('#ffffff', { map: texture });
      return mesh(parent, geometry(`plane:${width}:${height}`, () => new THREE.PlaneGeometry(width, height)), labelMaterial, position, false);
    }

    function bolt(parent, position, boltMaterial = palette.brass, radius = .045) {
      const boltMesh = cylinder(parent, radius, .055, boltMaterial, position);
      boltMesh.rotation.x = Math.PI / 2;
      return boltMesh;
    }

    function star(parent, size, meshMaterial, position) {
      const starGeometry = geometry(`star:${size}`, () => {
        const shape = new THREE.Shape();
        for (let point = 0; point < 8; point++) {
          const angle = point / 8 * Math.PI * 2 + Math.PI / 2;
          const radius = point % 2 ? size * .29 : size;
          if (point === 0) shape.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
          else shape.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
        }
        shape.closePath();
        return new THREE.ExtrudeGeometry(shape, { depth: .055, bevelEnabled: true, bevelSize: .015, bevelThickness: .015, bevelSegments: 2, steps: 1 });
      });
      return mesh(parent, starGeometry, meshMaterial, position);
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      renderer.setAnimationLoop(null);
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      listeners.abort();
      disposables.forEach((resource) => resource.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    }

    destroyScene = dispose;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.setAttribute('aria-label', '黑灰机身、柔和轮廓光与暖橙炉火的三维锻造工坊。左右拖动或按方向键旋转，双击或按 Home 键复位。');
    world.add(model);
    world.add(new THREE.HemisphereLight('#e3e5ee', '#16171c', 1.4));
    const keyLight = new THREE.DirectionalLight('#f0f0f4', 2.1);
    keyLight.position.set(-3.5, 8, 5);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.radius = 3;
    Object.assign(keyLight.shadow.camera, { left: -7, right: 7, top: 6, bottom: -6, near: .5, far: 22 });
    keyLight.shadow.bias = -.0004;
    keyLight.shadow.normalBias = .025;
    world.add(keyLight);
    const rimLight = new THREE.DirectionalLight('#b4c1d9', 1.3);
    rimLight.position.set(5, 4, -5);
    world.add(rimLight);
    const groundMaterial = track(new THREE.ShadowMaterial({ opacity: .3 }));
    const ground = mesh(world, track(new THREE.PlaneGeometry(200, 200)), groundMaterial, [0, -.38, 0], false);
    ground.rotation.x = -Math.PI / 2;

    box(model, 10.1, .34, 3.5, palette.wood, [0, -.18, 0], .3);
    box(model, 9.9, .06, 3.36, palette.wood, [0, .015, 0], .2);
    label(model, 'S K I L L F O R G E', 2.3, .15, [0, -.15, 1.77], { fontScale: .5 });
    for (const side of [-1, 1]) {
      for (const depth of [-.52, .52]) {
        box(model, .14, .57, .15, palette.dark, [side * 3.66, .35, depth], .025);
        box(model, .44, .1, .4, palette.sage, [side * 3.66, .1, depth], .04);
      }
    }
    box(model, 8.7, .23, 1.42, palette.dark, [0, .7, 0], .11);
    box(model, 8.8, .13, .11, palette.pale, [0, .79, .76], .04);
    box(model, 8.8, .13, .11, palette.pale, [0, .79, -.76], .04);
    const slats = [];
    for (let index = 0; index < 31; index++) {
      const slat = box(model, .21, .075, 1.29, index % 2 ? palette.sage : palette.rubber, [-4.18 + index * .278, .85, 0], .015);
      slats.push(slat);
    }
    for (const side of [-1, 1]) {
      const endRoller = cylinder(model, .14, 1.33, palette.dark, [side * 4.2, .75, 0]);
      endRoller.rotation.x = Math.PI / 2;
      bolt(model, [side * 4.2, .75, .76], palette.brass, .07);
    }

    const furnace = new THREE.Group();
    model.add(furnace);
    box(furnace, 2.62, .22, 2.1, palette.dark, [0, .28, 0], .09);
    box(furnace, 2.43, 2.6, 1.83, palette.sage, [0, 1.74, 0], .3);
    box(furnace, 2.5, .2, 1.92, palette.pale, [0, 3.07, 0], .07);
    box(furnace, .78, .12, .68, palette.iron, [-.76, 3.2, .15], .025);
    box(furnace, 2.52, .22, 1.97, palette.pale, [0, .48, 0], .07);
    box(furnace, 2.22, .37, .1, palette.pale, [0, 2.73, .94], .08);
    label(furnace, 'SF — 001', .69, .18, [-.56, 2.74, 1.001]);
    const statusMaterial = material('#b6dcd0', { emissive: '#8bc6b6', emissiveIntensity: .25 });
    bolt(furnace, [.8, 2.74, 1], statusMaterial, .055);
    box(furnace, 1.96, 1.66, .2, palette.dark, [0, 1.66, .98], .2);
    box(furnace, 1.72, 1.42, .08, palette.brass, [0, 1.66, 1.1], .18);
    box(furnace, 1.58, 1.3, .07, palette.ink, [0, 1.66, 1.155], .17);
    const hearthMaterial = material('#fa9540', { emissive: '#ff6217', emissiveIntensity: 1.3 });
    box(furnace, 1.23, .1, .16, hearthMaterial, [0, 1.07, 1.23], .04);
    const fireLight = new THREE.PointLight('#ff9b43', 2.2, 4, 2);
    fireLight.position.set(0, 1.55, 1.6);
    furnace.add(fireLight);
    const flameGeometry = track(new THREE.PlaneGeometry(.62, 1.08));
    flameGeometry.translate(0, .54, 0);
    const flames = [];
    for (let index = 0; index < 5; index++) {
      const flameMaterial = track(new THREE.ShaderMaterial({
        uniforms: { flameTime: { value: 0 }, flameSeed: { value: index * 3.71 } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        vertexShader: `
          varying vec2 flameUv;
          void main() {
            flameUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float flameTime;
          uniform float flameSeed;
          varying vec2 flameUv;

          float hash(vec2 point) {
            return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453);
          }

          float noise(vec2 point) {
            vec2 cell = floor(point);
            vec2 local = fract(point);
            vec2 blend = local * local * (3.0 - 2.0 * local);
            return mix(
              mix(hash(cell), hash(cell + vec2(1.0, 0.0)), blend.x),
              mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0)), blend.x),
              blend.y
            );
          }

          float turbulence(vec2 point) {
            return noise(point) * .57 + noise(point * 2.03 + 9.2) * .28 + noise(point * 4.07 + 21.3) * .15;
          }

          void main() {
            float height = flameUv.y;
            float time = flameTime + flameSeed;
            vec2 flow = vec2(flameUv.x * 4.5 + flameSeed, height * 3.8 - time * 1.9);
            float eddies = turbulence(flow);
            float curl = (noise(vec2(height * 2.8 - time * .9, flameSeed)) - .5) * height * .48;
            float distanceToCore = abs(flameUv.x - .5 - curl);
            float taper = pow(max(0.0, 1.0 - height), .85);
            float density = taper * .43 - distanceToCore + (eddies - .5) * (.12 + height * .38);
            float silhouette = smoothstep(-.035, .085, density);
            float dissolve = 1.0 - smoothstep(.56 + eddies * .28, 1.0, height);
            float opacity = silhouette * dissolve * smoothstep(0.0, .07, height) * (.48 + eddies * .32);
            float heat = clamp(density * 3.5 + (1.0 - height) * .32, 0.0, 1.0);
            vec3 color = mix(vec3(1.0, .055, .004), vec3(1.0, .43, .035), smoothstep(.12, .65, heat));
            color = mix(color, vec3(1.0, .88, .53), smoothstep(.64, 1.0, heat));
            gl_FragColor = vec4(color, opacity);
            #include <colorspace_fragment>
          }
        `
      }));
      const flame = mesh(furnace, flameGeometry, flameMaterial, [(index - 2) * .2, 1.1, 1.25 + (index % 2) * .07], false);
      flame.scale.set(index === 2 ? 1.05 : .9, index === 2 ? 1 : .76, 1);
      flame.rotation.y = (index - 2) * .08;
      flame.receiveShadow = false;
      flames.push(flame);
    }
    const embers = Array.from({ length: 8 }, (_, index) => {
      const emberMaterial = track(new THREE.MeshBasicMaterial({ color: '#ffc16b', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      const ember = sphere(furnace, .012 + (index % 3) * .003, emberMaterial, [0, 1.1, 1.34]);
      ember.receiveShadow = false;
      return ember;
    });
    for (const horizontal of [-.91, .91]) {
      for (const vertical of [1.01, 2.32]) bolt(furnace, [horizontal, vertical, 1.11], palette.iron);
    }
    for (let index = 0; index < 4; index++) box(furnace, .22, .055, .05, palette.dark, [-.65 + index * .3, .69, .96], .018);
    const gauge = new THREE.Group();
    gauge.position.set(.81, .72, 1.02);
    furnace.add(gauge);
    const pressureSafe = material('#68b590', { emissive: '#68b590', emissiveIntensity: .2 });
    const pressureWarning = material('#eea451', { emissive: '#eea451', emissiveIntensity: .35 });
    const pressureDanger = material('#f16565', { emissive: '#ed4444', emissiveIntensity: .6 });
    const gaugeFace = cylinder(gauge, .21, .08, palette.deep, [0, 0, 0]);
    gaugeFace.rotation.x = Math.PI / 2;
    const gaugeRim = torus(gauge, .21, .025, palette.brass, [0, 0, .05]);
    const gaugeNeedle = new THREE.Group();
    gaugeNeedle.position.z = .085;
    gauge.add(gaugeNeedle);
    box(gaugeNeedle, .016, .155, .014, palette.cream, [0, .065, 0], .004);
    bolt(gauge, [0, 0, .085], palette.brass, .022);
    gaugeNeedle.rotation.z = 2.3;
    for (let index = 0; index <= 25; index++) {
      const ratio = index / 25;
      const angle = 2.3 - ratio * 4.6;
      const tickMaterial = ratio <= .42 ? pressureSafe : ratio < .8 ? pressureWarning : pressureDanger;
      const tick = box(gauge, .012, .033, .008, tickMaterial, [-Math.sin(angle) * .17, Math.cos(angle) * .17, .055], .002);
      tick.rotation.z = angle;
    }
    const glassMaterial = track(new THREE.MeshBasicMaterial({ color: '#f5f9ff', transparent: true, opacity: .08, depthWrite: false }));
    const gaugeGlass = cylinder(gauge, .19, .012, glassMaterial, [0, 0, .11]);
    gaugeGlass.rotation.x = Math.PI / 2;
    const gaugeCracks = new THREE.Group();
    gauge.add(gaugeCracks);
    for (let index = 0; index < 5; index++) {
      const angle = index * 1.21;
      const crack = box(gaugeCracks, .009, .16, .008, pressureDanger, [Math.sin(angle) * .065, Math.cos(angle) * .065, .12], .002);
      crack.rotation.z = -angle;
    }
    gaugeCracks.visible = false;
    const pressureReadout = label(furnace, '0', .65, .13, [.78, .43, 1.13], { fontScale: .7 });
    let displayedCharacters = -1;

    const chimneyBase = cylinder(furnace, .28, .12, palette.dark, [-.76, 3.23, -.38]);
    cylinder(furnace, .18, .64, palette.dark, [-.76, 3.54, -.38]);
    cylinder(furnace, .27, .13, palette.pale, [-.76, 3.85, -.38]);
    cylinder(furnace, .15, .02, palette.ink, [-.76, 3.93, -.38]);
    chimneyBase.castShadow = false;
    const smoke = [];
    const smokeCanvas = document.createElement('canvas');
    smokeCanvas.width = smokeCanvas.height = 64;
    const smokeContext = smokeCanvas.getContext('2d');
    const gradient = smokeContext.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(151, 168, 193, .3)');
    gradient.addColorStop(.4, 'rgba(151, 168, 193, .14)');
    gradient.addColorStop(1, 'rgba(151, 168, 193, 0)');
    smokeContext.fillStyle = gradient;
    smokeContext.fillRect(0, 0, 64, 64);
    const smokeTexture = track(new THREE.CanvasTexture(smokeCanvas));
    smokeTexture.colorSpace = THREE.SRGBColorSpace;
    for (let index = 0; index < 6; index++) {
      const smokeMaterial = track(new THREE.SpriteMaterial({ map: smokeTexture, transparent: true, opacity: 0, depthWrite: false }));
      const puff = new THREE.Sprite(smokeMaterial);
      model.add(puff);
      smoke.push(puff);
    }

    const gearMount = new THREE.Group();
    gearMount.position.set(1.29, 1.82, .02);
    gearMount.rotation.y = Math.PI / 2;
    furnace.add(gearMount);
    const gear = new THREE.Group();
    gearMount.add(gear);
    torus(gear, .42, .12, palette.brass, [0, 0, 0]);
    const axle = cylinder(gear, .12, .23, palette.iron, [0, 0, .03]);
    axle.rotation.x = Math.PI / 2;
    for (let index = 0; index < 10; index++) {
      const angle = index * Math.PI / 5;
      const tooth = box(gear, .16, .19, .19, palette.brass, [Math.cos(angle) * .48, Math.sin(angle) * .48, 0], .025);
      tooth.rotation.z = angle - Math.PI / 2;
    }
    for (let index = 0; index < 3; index++) {
      const spoke = box(gear, .09, .73, .1, palette.brass, [0, 0, 0], .015);
      spoke.rotation.z = index * Math.PI / 3;
    }
    const sidePipe = torus(furnace, .25, .065, palette.dark, [1.23, 2.55, -.36]);
    sidePipe.rotation.y = Math.PI / 2;

    box(furnace, .2, 1.2, .28, palette.dark, [.76, 3.51, -.18], .05);
    const hammer = new THREE.Group();
    hammer.position.set(.76, 3.66, .15);
    model.add(hammer);
    box(hammer, 1.57, .15, .17, palette.wood, [-.72, 0, 0], .035);
    box(hammer, .2, .2, .22, palette.brass, [-1.2, 0, 0], .025);
    box(hammer, .6, .59, .58, palette.iron, [-1.52, 0, 0], .13);
    box(hammer, .63, .09, .6, palette.iron, [-1.52, -.24, 0], .025);
    bolt(hammer, [0, 0, .16], palette.iron, .1);
    hammer.rotation.z = -.24;

    const phone = new THREE.Group();
    phone.position.set(-3.45, 1.66, .13);
    phone.rotation.z = -.13;
    phone.rotation.y = -.12;
    model.add(phone);
    box(phone, 1.02, 1.61, .19, palette.deep, [0, 0, 0], .12);
    box(phone, .85, 1.33, .025, palette.pale, [0, .015, .11], .07);
    const playShape = new THREE.Shape();
    playShape.moveTo(-.12, -.18); playShape.lineTo(.18, 0); playShape.lineTo(-.12, .18); playShape.closePath();
    mesh(phone, track(new THREE.ExtrudeGeometry(playShape, { depth: .035, bevelEnabled: false })), palette.dark, [0, .1, .13]);
    label(phone, '00:45', .48, .13, [0, -.44, .13]);
    box(phone, .25, .025, .02, palette.dark, [0, -.72, .11], .008);
    box(phone, .18, .026, .02, palette.ink, [0, .69, .13], .008);
    const scanMaterial = material('#ffc373', { emissive: '#ff8d35', emissiveIntensity: 1.1, transparent: true, opacity: .8 });
    const scanLine = box(phone, .88, .024, .025, scanMaterial, [0, .5, .15], .005);

    const papers = [];
    for (let index = 0; index < 3; index++) {
      const paper = new THREE.Group();
      box(paper, .66, .87, .06, palette.cream, [0, 0, 0], .04);
      label(paper, index === 0 ? 'Aa' : index === 1 ? 'IDEA' : '01', .42, .2, [0, .19, .036]);
      for (let line = 0; line < 3; line++) box(paper, .42 - line * .05, .025, .013, palette.sage, [-line * .02, -.04 - line * .11, .04], .004);
      model.add(paper);
      papers.push(paper);
    }

    const skill = new THREE.Group();
    model.add(skill);
    box(skill, 1.14, 1.5, .2, palette.brass, [0, 0, 0], .1);
    box(skill, 1.02, 1.37, .065, palette.pale, [0, 0, .12], .07);
    star(skill, .25, palette.brass, [0, .31, .18]);
    label(skill, 'SKILL', .79, .21, [0, -.16, .158], { fontScale: .65 });
    label(skill, 'READY TO USE', .78, .09, [0, -.42, .158], { fontScale: .62 });
    for (const corner of [-1, 1]) bolt(skill, [corner * .44, -.58, .17], palette.brass, .021);
    const pedestal = cylinder(model, .83, .11, palette.pale, [3.26, .21, .08]);
    const rewardRing = torus(model, .66, .035, palette.brass, [3.26, .29, .08]);
    rewardRing.rotation.x = -Math.PI / 2;
    const haloMaterial = material('#dce9fb', { emissive: '#bdcee9', emissiveIntensity: .15, transparent: true, opacity: .4 });
    const halo = torus(model, 1.03, .025, haloMaterial, [3.26, 1.98, -.28]);
    halo.visible = false;
    pedestal.receiveShadow = true;
    const orbitStars = Array.from({ length: 3 }, (_, index) => {
      const object = star(model, .13 - index * .02, palette.brass, [3.26, 2.7, .2]);
      object.visible = false;
      return object;
    });

    label(model, 'VIDEO IN', 1.1, .16, [-3.35, .065, 1.12], { fontScale: .5 }).rotation.x = -Math.PI / 2;
    label(model, 'KNOWLEDGE FORGE', 1.68, .15, [0, .065, 1.32], { fontScale: .5 }).rotation.x = -Math.PI / 2;
    label(model, 'SKILL OUT', 1.1, .16, [3.25, .065, 1.12], { fontScale: .5 }).rotation.x = -Math.PI / 2;
    for (const horizontal of [-4.56, 4.56]) {
      for (const depth of [-1.3, 1.3]) {
        const screw = cylinder(model, .045, .025, palette.brass, [horizontal, .06, depth]);
        screw.castShadow = false;
      }
    }

    const sparkMaterial = material('#ffcf7e', { emissive: '#ff9c36', emissiveIntensity: 3 });
    const sparkGeometry = track(new THREE.OctahedronGeometry(.035));
    const sparks = Array.from({ length: 18 }, () => {
      const spark = mesh(model, sparkGeometry, sparkMaterial, [0, 0, 0], false);
      spark.visible = false;
      return { mesh: spark, velocity: new THREE.Vector3(), life: 0 };
    });
    const confettiGeometry = track(new THREE.BoxGeometry(.07, .12, .022));
    const confettiMaterials = [palette.orange, palette.brass, palette.pale, palette.dark];
    const confetti = Array.from({ length: 40 }, (_, index) => {
      const piece = mesh(model, confettiGeometry, confettiMaterials[index % 4], [3.26, 2, 0], false);
      piece.visible = false;
      return { mesh: piece, velocity: new THREE.Vector3(), spin: new THREE.Vector3() };
    });

    function burstSparks() {
      sparks.forEach((spark) => {
        spark.mesh.position.set(-.76, 3.28, .15);
        spark.velocity.set((Math.random() - .5) * 2.8, .7 + Math.random() * 1.8, .35 + Math.random() * 1.5);
        spark.life = .45 + Math.random() * .35;
        spark.mesh.visible = true;
      });
    }

    function burstConfetti() {
      confetti.forEach((piece) => {
        piece.mesh.position.set(3.26, 2.2, .1);
        piece.mesh.rotation.set(0, 0, 0);
        piece.mesh.scale.setScalar(1);
        piece.velocity.set((Math.random() - .5) * 4, 2 + Math.random() * 3, (Math.random() - .5) * 3);
        piece.spin.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
        piece.mesh.visible = true;
      });
    }

    function resetView() {
      targetYaw = 0; targetPitch = 0; hoverYaw = 0; hoverPitch = 0;
    }

    function updateCamera(delta) {
      const easing = reducedMotion.matches ? 1 : 1 - Math.exp(-delta * 9);
      currentYaw += (targetYaw + hoverYaw - currentYaw) * easing;
      currentPitch += (targetPitch + hoverPitch - currentPitch) * easing;
      const yaw = .44 + currentYaw;
      const pitch = .43 + currentPitch;
      camera.position.set(Math.sin(yaw) * Math.cos(pitch) * 16, 1.6 + Math.sin(pitch) * 16, Math.cos(yaw) * Math.cos(pitch) * 16);
      camera.lookAt(cameraTarget);
    }

    function resize() {
      const width = Math.max(1, viewport.clientWidth);
      const height = Math.max(1, viewport.clientHeight);
      const aspect = width / height;
      const viewHeight = Math.max(6.6, 11.6 / aspect);
      camera.left = -viewHeight * aspect / 2;
      camera.right = viewHeight * aspect / 2;
      camera.top = viewHeight / 2;
      camera.bottom = -viewHeight / 2;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
      renderer.setSize(width, height, false);
    }

    function renderFrame(timestamp) {
      if (disposed || contextLost) return;
      if (document.hidden || !inView) { previousTimestamp = 0; return; }
      const delta = previousTimestamp ? Math.min((timestamp - previousTimestamp) / 1000, .05) : 1 / 60;
      previousTimestamp = timestamp;
      const state = window.getForgeState?.() || { phase: -1, progress: 0, active: false, paused: false, completed: false };
      const moving = !state.paused && !reducedMotion.matches;
      const running = state.active && moving;
      const animationDelta = moving ? delta : 0;
      if (moving) motionTime += delta;
      if (state.completed && !wasCompleted) {
        celebrationTime = 0;
        if (!reducedMotion.matches) burstConfetti();
      }
      if (!state.completed) {
        celebrationTime = -1;
        confetti.forEach((piece) => { piece.mesh.visible = false; });
      }
      if (reducedMotion.matches) confetti.forEach((piece) => { piece.mesh.visible = false; });
      wasCompleted = state.completed;
      if (celebrationTime >= 0) celebrationTime += animationDelta;

      slats.forEach((slat, index) => {
        slat.position.x = -4.18 + ((index * .278 + (running ? motionTime * .7 : 0)) % 8.62);
      });
      gear.rotation.z = reducedMotion.matches ? 0 : -motionTime * (state.active ? 1.2 : .1);
      const pressure = window.skillforgePressure.getPressure(state.characters || 0);
      const overloaded = pressure.level === 'overload';
      const alarming = pressure.level === 'warning' || overloaded;
      const needleAngle = overloaded ? -2.72 : 2.3 - pressure.ratio * 4.6;
      gaugeNeedle.rotation.z += (needleAngle - gaugeNeedle.rotation.z) * (reducedMotion.matches ? 1 : 1 - Math.exp(-delta * 5));
      gauge.rotation.z = alarming && moving ? Math.sin(motionTime * 19) * (overloaded ? .035 : .012) : 0;
      gaugeRim.material = overloaded ? pressureDanger : alarming ? pressureWarning : palette.brass;
      gaugeGlass.visible = !overloaded;
      gaugeCracks.visible = overloaded;
      if (displayedCharacters !== pressure.characters) {
        const texture = pressureReadout.material.map;
        const context = texture.image.getContext('2d');
        context.fillStyle = '#202126';
        context.fillRect(0, 0, texture.image.width, texture.image.height);
        context.fillStyle = overloaded ? '#f16565' : alarming ? '#eea451' : '#b9dec9';
        const text = overloaded ? 'OVERLOAD' : pressure.characters.toLocaleString('en-US');
        context.fillText(text, 256, texture.image.height * .52, 460);
        texture.needsUpdate = true;
        displayedCharacters = pressure.characters;
      }
      statusMaterial.color.set(alarming ? '#f16565' : '#b6dcd0');
      statusMaterial.emissive.set(alarming ? '#ed4444' : '#8bc6b6');
      statusMaterial.emissiveIntensity = alarming ? .8 + (moving ? Math.sin(motionTime * Math.PI * 2) * .15 : 0) : state.completed ? 1 : state.active ? .45 + Math.sin(motionTime * 4) * .2 : .15;
      const fireFlicker = Math.sin(motionTime * 7) * .3 + Math.sin(motionTime * 13.7) * .14 + Math.sin(motionTime * 3.1 + .8) * .18;
      fireLight.intensity = (state.active ? 2.2 : .9) + fireFlicker * .45;
      hearthMaterial.emissiveIntensity = 1.15 + fireFlicker * .45;
      flames.forEach((flame, index) => {
        const flicker = Math.sin(motionTime * 4.7 + index * 1.9) * .055 + Math.sin(motionTime * 8.3 + index) * .025;
        const strength = state.active ? 1 : .8;
        flame.material.uniforms.flameTime.value = motionTime;
        flame.scale.y = ((index === 2 ? 1.05 : .78) + flicker) * strength;
      });
      embers.forEach((ember, index) => {
        const age = (motionTime * (.37 + index * .017) + index / embers.length) % 1;
        ember.position.set(Math.sin(index * 2.4) * .42 + Math.sin(age * 5 + index) * age * .1, 1.14 + age * .98, 1.34);
        ember.material.opacity = reducedMotion.matches ? 0 : Math.sin(age * Math.PI) * (state.active ? .75 : .38);
        ember.scale.setScalar(1 - age * .7);
      });
      smoke.forEach((puff, index) => {
        const age = (motionTime * .36 + index / smoke.length) % 1;
        puff.position.set(-.76 + Math.sin(age * 5 + index) * age * .25, 4 + age * .95, -.38 - age * .12);
        puff.scale.setScalar(.45 + age * 1.45);
        puff.material.opacity = reducedMotion.matches ? 0 : Math.sin(age * Math.PI) * (state.active ? .5 : .22);
      });
      phone.position.y = 1.73;
      phone.rotation.z = -.13 + (running && state.phase === 0 ? Math.sin(motionTime * 4) * .025 : 0);
      scanLine.visible = state.active && state.phase === 0;
      scanLine.position.y = .53 - (Math.sin(motionTime * 3) * .5 + .5) * 1.05;
      papers.forEach((paper, index) => {
        const travel = running && state.phase < 3 ? (motionTime * .38 + index / 3) % 1 : index / 3;
        paper.position.set(-2.72 + travel * 1.8, 1.35 + Math.sin(travel * Math.PI) * .2, .25 - index * .08);
        paper.rotation.set(0, -.12 + travel * .2, -.12 + index * .12);
        paper.scale.setScalar(1 - Math.max(0, travel - .68) * 2.8);
        paper.visible = !state.completed && (state.phase <= 1 || !state.active);
      });

      const hammerWorking = (state.phase === 2 && state.active) || (!state.active && !state.completed);
      if (hammerWorking) {
        const strikePosition = motionTime * (state.active ? 1.15 : .42);
        const strikeFraction = strikePosition % 1;
        const lift = -.56;
        const contact = .075;
        const angle = strikeFraction < .58
          ? contact + (lift - contact) * Math.sin(strikeFraction / .58 * Math.PI / 2)
          : strikeFraction < .82
            ? lift + (contact - lift) * Math.pow((strikeFraction - .58) / .24, 2)
            : contact - Math.sin((strikeFraction - .82) / .18 * Math.PI) * .055;
        hammer.rotation.z = reducedMotion.matches ? -.24 : angle;
        const strike = Math.floor(strikePosition);
        if (strikeFraction >= .82 && strike !== lastStrike && moving) { burstSparks(); lastStrike = strike; }
        furnace.position.y = reducedMotion.matches ? 0 : strikeFraction > .82 && strikeFraction < .88 ? -.008 : 0;
      } else {
        hammer.rotation.z = -.24;
        furnace.position.y = 0;
        lastStrike = -1;
      }
      sparks.forEach((spark) => {
        if (reducedMotion.matches) spark.life = 0;
        if (spark.life <= 0) { spark.mesh.visible = false; return; }
        spark.life -= animationDelta;
        spark.velocity.y -= animationDelta * 9.8;
        spark.mesh.position.addScaledVector(spark.velocity, animationDelta);
        spark.mesh.scale.setScalar(Math.max(0, Math.min(1, spark.life * 4)));
      });

      const reveal = state.completed ? 1 : THREE.MathUtils.smoothstep(state.progress, .75, 1);
      skill.position.set(3.26, 1.5 + reveal * .17, .12);
      skill.scale.setScalar(.77 + reveal * .23);
      skill.rotation.set(-.04, -.12, -.08);
      if (state.completed && !reducedMotion.matches && celebrationTime < 1.4) {
        const turn = Math.min(1, celebrationTime / 1.4);
        skill.rotation.y += Math.sin(turn * Math.PI * 2) * (1 - turn) * .12;
        skill.position.y += Math.sin(turn * Math.PI) * .06;
      }
      halo.visible = reveal > 0;
      halo.material.opacity = .15 + reveal * .4;
      halo.rotation.y = -.15 + (moving ? Math.sin(motionTime * .6) * .12 : 0);
      orbitStars.forEach((object, index) => {
        const angle = motionTime * .55 + index * Math.PI * 2 / 3;
        object.visible = state.completed;
        object.position.set(3.26 + Math.cos(angle) * 1.05, 2.1 + Math.sin(angle) * .8, .25 + Math.sin(angle * .8) * .28);
        object.rotation.y = motionTime * .8 + index;
      });
      confetti.forEach((piece) => {
        if (!piece.mesh.visible) return;
        piece.velocity.y -= animationDelta * 3.8;
        piece.mesh.position.addScaledVector(piece.velocity, animationDelta);
        piece.mesh.rotation.x += piece.spin.x * animationDelta;
        piece.mesh.rotation.y += piece.spin.y * animationDelta;
        piece.mesh.rotation.z += piece.spin.z * animationDelta;
        piece.mesh.scale.setScalar(Math.max(0, 1 - Math.max(0, celebrationTime - 1.2) / .8));
        if (celebrationTime > 2 || piece.mesh.position.y < .1) piece.mesh.visible = false;
      });
      updateCamera(delta);
      renderer.render(world, camera);
    }

    const canvas = renderer.domElement;
    canvas.addEventListener('pointerdown', (event) => {
      if (!event.isPrimary || event.button !== 0) return;
      dragging = true;
      pointerId = event.pointerId;
      pointerStart = { x: event.clientX, y: event.clientY };
      dragStartYaw = targetYaw;
      dragStartPitch = targetPitch;
      hoverYaw = 0; hoverPitch = 0;
      canvas.setPointerCapture(event.pointerId);
    }, { signal: listeners.signal });
    canvas.addEventListener('pointermove', (event) => {
      if (dragging && event.pointerId === pointerId) {
        targetYaw = THREE.MathUtils.clamp(dragStartYaw + (event.clientX - pointerStart.x) * .006, -.95, .65);
        if (event.pointerType !== 'touch') targetPitch = THREE.MathUtils.clamp(dragStartPitch + (event.clientY - pointerStart.y) * .003, -.12, .22);
      } else if (event.pointerType === 'mouse' && !reducedMotion.matches) {
        const bounds = canvas.getBoundingClientRect();
        hoverYaw = ((event.clientX - bounds.left) / bounds.width - .5) * .09;
        hoverPitch = ((event.clientY - bounds.top) / bounds.height - .5) * .04;
      }
    }, { signal: listeners.signal });
    const stopDrag = (event) => {
      if (event.pointerId !== pointerId) return;
      dragging = false;
      if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
      pointerId = null;
    };
    canvas.addEventListener('pointerup', stopDrag, { signal: listeners.signal });
    canvas.addEventListener('pointercancel', stopDrag, { signal: listeners.signal });
    canvas.addEventListener('lostpointercapture', () => { dragging = false; pointerId = null; }, { signal: listeners.signal });
    canvas.addEventListener('pointerleave', () => { hoverYaw = 0; hoverPitch = 0; }, { signal: listeners.signal });
    canvas.addEventListener('dblclick', resetView, { signal: listeners.signal });
    canvas.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
      event.preventDefault();
      if (event.key === 'Home') resetView();
      if (event.key === 'ArrowLeft') targetYaw = Math.max(-.95, targetYaw - .12);
      if (event.key === 'ArrowRight') targetYaw = Math.min(.65, targetYaw + .12);
      if (event.key === 'ArrowUp') targetPitch = Math.min(.22, targetPitch + .06);
      if (event.key === 'ArrowDown') targetPitch = Math.max(-.12, targetPitch - .06);
    }, { signal: listeners.signal });
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      contextLost = true;
      renderer.setAnimationLoop(null);
      showRendererError('3D 渲染已中断，正在等待恢复，也可以点击重试');
    }, { signal: listeners.signal });
    canvas.addEventListener('webglcontextrestored', () => {
      if (disposed) return;
      contextLost = false;
      previousTimestamp = 0;
      sceneElement.classList.add('has-three');
      loading.hidden = true;
      sceneElement.dataset.renderer = 'three';
      renderer.setAnimationLoop(renderFrame);
    }, { signal: listeners.signal });
    document.addEventListener('visibilitychange', () => { previousTimestamp = 0; }, { signal: listeners.signal });
    window.addEventListener('pagehide', (event) => { if (!event.persisted) dispose(); }, { signal: listeners.signal });
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(viewport);
    if ('IntersectionObserver' in window) {
      intersectionObserver = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; previousTimestamp = 0; });
      intersectionObserver.observe(viewport);
    }
    viewport.replaceChildren(canvas);
    resize();
    updateCamera(1);
    renderFrame(performance.now());
    renderer.setAnimationLoop(renderFrame);
    sceneElement.classList.add('has-three');
    loading.hidden = true;
    sceneElement.dataset.renderer = 'three';
  }

  async function startScene() {
    if (loadingEngine) return;
    loadingEngine = true;
    sceneElement.classList.remove('has-three');
    sceneElement.dataset.renderer = 'loading';
    loading.hidden = false;
    retryButton.hidden = true;
    loadingText.textContent = '正在唤醒立体小工厂…';
    destroyScene?.();
    destroyScene = undefined;
    try {
      const THREE = await loadEngine();
      buildScene(THREE);
    } catch (error) {
      destroyScene?.();
      destroyScene = undefined;
      console.warn('[SkillForge 3D]', error);
      showRendererError(cachedEngine ? 'WebGL 暂不可用，请检查硬件加速后重试' : '3D 引擎加载失败，请安装依赖后重试');
    } finally {
      loadingEngine = false;
    }
  }

  retryButton.addEventListener('click', startScene);

  startScene();
})();
