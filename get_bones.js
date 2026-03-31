import * as THREE from 'three';
import fs from 'fs';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// We just need a node script to parse the GLB and print armature names to bind to
// Wait, we can't easily run GLTFLoader in Node without canvas/JSDOM mock.
// Better to just let the client log it or try a known path.
console.log("We will just dump the hierarchy in the client side using console.log for a moment.");
