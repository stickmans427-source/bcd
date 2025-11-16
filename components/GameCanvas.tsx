import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import { getFirebaseService, FirebaseService } from '../services/firebaseService';
import type { PlayerData, BlastData } from '../types';

const NUM_BOTS = 3;
const BOT_MOVE_SPEED = 4;
const ARENA_BOUNDS = 90;

type Bot = {
  mesh: THREE.Mesh;
  target: THREE.Vector3;
  state: 'moving' | 'idle';
  idleUntil: number;
  lastShotTime: number;
};

type Blast = {
  mesh: THREE.Mesh;
  direction: THREE.Vector3;
  life: number;
};

const GameCanvas: React.FC = () => {
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef(new THREE.Scene());
  const cameraRef = useRef(new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000));
  const localPlayerRef = useRef<THREE.Mesh | null>(null);
  const remotePlayersRef = useRef<Record<string, THREE.Mesh>>({});
  const botsRef = useRef<Record<string, Bot>>({});
  const blastsRef = useRef<Blast[]>([]);
  const keysPressed = useRef<Record<string, boolean>>({});
  const mouseState = useRef({ x: 0, y: 0, isDown: false, prevX: 0 });
  const animationFrameId = useRef<number>();
  
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const firebaseServiceRef = useRef<FirebaseService | null>(null);

  const spawnBlast = useCallback((position: THREE.Vector3, direction: THREE.Vector3, color: THREE.ColorRepresentation) => {
    const blastGeo = new THREE.CylinderGeometry(0.2, 0.2, 3, 16);
    const blastMat = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 4,
        transparent: true,
        opacity: 0.8
    });
    const blastMesh = new THREE.Mesh(blastGeo, blastMat);
    blastMesh.position.copy(position);
    blastMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
    
    sceneRef.current.add(blastMesh);
    blastsRef.current.push({
        mesh: blastMesh,
        direction: direction.clone().normalize(),
        life: 2, // 2 seconds lifetime
    });
  }, []);

  const fireBlast = useCallback(() => {
    if (!localPlayerRef.current || !playerId || !firebaseServiceRef.current) return;

    const player = localPlayerRef.current;
    const position = player.position.clone();
    const direction = new THREE.Vector3();
    player.getWorldDirection(direction);
    
    // Create visual locally
    spawnBlast(position, direction, 0x00ffaa);

    // Send to firebase for others
    firebaseServiceRef.current.sendBlast({
      playerId,
      position: { x: position.x, y: position.y, z: position.z },
      direction: { x: direction.x, y: direction.y, z: direction.z },
    });
  }, [playerId, spawnBlast]);

  useEffect(() => {
    const mountNode = mountRef.current;
    if (!mountNode) return;

    // --- Basic Scene Setup ---
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    scene.background = new THREE.Color(0x050510);
    scene.fog = new THREE.Fog(0x050510, 50, 150);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    mountNode.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // --- Lighting ---
    const ambientLight = new THREE.AmbientLight(0x404040, 2);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
    directionalLight.position.set(10, 20, 5);
    directionalLight.castShadow = true;
    scene.add(directionalLight);

    // --- Ground ---
    const groundGeo = new THREE.PlaneGeometry(200, 200);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x101018 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // --- Local Player ---
    const playerGeo = new THREE.SphereGeometry(1, 32, 16);
    const playerMat = new THREE.MeshStandardMaterial({
      color: 0x00ffff,
      emissive: 0x00ffff,
      emissiveIntensity: 2,
    });
    const playerMesh = new THREE.Mesh(playerGeo, playerMat);
    playerMesh.position.set(Math.random() * 20 - 10, 1, Math.random() * 20 - 10);
    playerMesh.castShadow = true;
    scene.add(playerMesh);
    localPlayerRef.current = playerMesh;
    
    // --- Bot Management ---
    const spawnBots = () => {
      if (Object.keys(botsRef.current).length > 0) return;
      console.log("Spawning bots...");
      for(let i = 0; i < NUM_BOTS; i++) {
        const botId = `bot_${i}`;
        const botGeo = new THREE.SphereGeometry(1, 32, 16);
        const botMat = new THREE.MeshStandardMaterial({ color: 0xff8c00, emissive: 0xff8c00, emissiveIntensity: 1.5 });
        const botMesh = new THREE.Mesh(botGeo, botMat);
        botMesh.castShadow = true;
        botMesh.position.set(
            (Math.random() - 0.5) * ARENA_BOUNDS,
            1,
            (Math.random() - 0.5) * ARENA_BOUNDS
        );
        scene.add(botMesh);
        botsRef.current[botId] = {
            mesh: botMesh,
            target: new THREE.Vector3((Math.random() - 0.5) * ARENA_BOUNDS, 1, (Math.random() - 0.5) * ARENA_BOUNDS),
            state: 'moving',
            idleUntil: 0,
            lastShotTime: Date.now(),
        };
      }
    };

    const despawnBots = () => {
        if (Object.keys(botsRef.current).length === 0) return;
        console.log("Despawning bots...");
        Object.values(botsRef.current).forEach((bot: Bot) => {
            scene.remove(bot.mesh);
            bot.mesh.geometry.dispose();
            (bot.mesh.material as THREE.Material).dispose();
        });
        botsRef.current = {};
    };

    // --- Firebase & Listeners Setup ---
    let unsubPlayers: (() => void) | undefined;
    let unsubBlasts: (() => void) | undefined;
    
    const handlePlayersUpdate = (players: PlayerData[], localPlayerId: string) => {
      const currentRemoteIds = Object.keys(remotePlayersRef.current);
      const incomingRemoteIds: string[] = [];

      let remotePlayerCount = 0;
      players.forEach(player => {
        if (player.id === localPlayerId) return;
        remotePlayerCount++;
        incomingRemoteIds.push(player.id);

        let remotePlayerMesh = remotePlayersRef.current[player.id];
        if (!remotePlayerMesh) {
          const remotePlayerGeo = new THREE.SphereGeometry(1, 32, 16);
          const remotePlayerMat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 1 });
          remotePlayerMesh = new THREE.Mesh(remotePlayerGeo, remotePlayerMat);
          remotePlayerMesh.castShadow = true;
          scene.add(remotePlayerMesh);
          remotePlayersRef.current[player.id] = remotePlayerMesh;
        }
        remotePlayerMesh.position.set(player.x, player.y, player.z);
        remotePlayerMesh.rotation.y = player.rotY;
      });

      if (remotePlayerCount === 0) {
        spawnBots();
      } else {
        despawnBots();
      }

      const disconnectedIds = currentRemoteIds.filter(id => !incomingRemoteIds.includes(id));
      disconnectedIds.forEach(id => {
        const meshToRemove = remotePlayersRef.current[id];
        if (meshToRemove) {
          scene.remove(meshToRemove);
          meshToRemove.geometry.dispose();
          (meshToRemove.material as THREE.Material).dispose();
          delete remotePlayersRef.current[id];
        }
      });
    };
    
    const handleBlastsUpdate = (blasts: BlastData[], localPlayerId: string) => {
        blasts.forEach(blastData => {
            if (blastData.playerId === localPlayerId) return; // Don't render our own blasts from firebase
            const position = new THREE.Vector3(blastData.position.x, blastData.position.y, blastData.position.z);
            const direction = new THREE.Vector3(blastData.direction.x, blastData.direction.y, blastData.direction.z);
            spawnBlast(position, direction, 0x00ffaa);
        });
    };

    const initializeApp = async () => {
      try {
        const service = getFirebaseService();
        firebaseServiceRef.current = service;
        const user = await service.signIn();
        setPlayerId(user.uid);
        
        unsubPlayers = service.onPlayersUpdate((players) => handlePlayersUpdate(players, user.uid));
        unsubBlasts = service.onBlastsUpdate((blasts) => handleBlastsUpdate(blasts, user.uid));
      } catch(err) {
        console.error("Firebase initialization failed:", err);
        if (err instanceof Error) {
            setError(err.message);
        } else {
            setError("An unknown error occurred during Firebase setup.");
        }
      } finally {
        setIsLoading(false);
      }
    };
    initializeApp();
    
    // --- Window Resize ---
    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    // --- Controls ---
    const onKeyDown = (event: KeyboardEvent) => { keysPressed.current[event.key.toLowerCase()] = true; if(event.key.toLowerCase() === 'f') fireBlast(); };
    const onKeyUp = (event: KeyboardEvent) => { keysPressed.current[event.key.toLowerCase()] = false; };
    const onMouseDown = (event: MouseEvent) => { mouseState.current.isDown = true; mouseState.current.prevX = event.clientX; };
    const onMouseUp = () => { mouseState.current.isDown = false; };
    const onMouseMove = (event: MouseEvent) => {
        if (mouseState.current.isDown) {
            const deltaX = event.clientX - mouseState.current.prevX;
            mouseState.current.prevX = event.clientX;
            if (localPlayerRef.current) {
                localPlayerRef.current.rotation.y -= deltaX * 0.005;
            }
        }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    mountNode.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mousemove', onMouseMove);

    // --- Cleanup ---
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      mountNode.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('mousemove', onMouseMove);

      unsubPlayers?.();
      unsubBlasts?.();
      despawnBots();
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
      if (rendererRef.current) mountNode.removeChild(rendererRef.current.domElement);
    };
  }, [fireBlast, spawnBlast]);

  // --- Animation Loop ---
  useEffect(() => {
    if (isLoading || error) return;

    const clock = new THREE.Clock();
    let lastUpdateTime = 0;

    const updateBots = (delta: number) => {
        const player = localPlayerRef.current;
        if (!player) return;

        Object.values(botsRef.current).forEach((bot: Bot) => {
            const now = Date.now();
            if (bot.state === 'idle' && now > bot.idleUntil) {
                bot.state = 'moving';
                bot.target.set(
                    (Math.random() - 0.5) * ARENA_BOUNDS,
                    1,
                    (Math.random() - 0.5) * ARENA_BOUNDS
                );
            }

            if (bot.state === 'moving') {
                const direction = bot.target.clone().sub(bot.mesh.position).normalize();
                bot.mesh.position.add(direction.multiplyScalar(BOT_MOVE_SPEED * delta));
                bot.mesh.lookAt(bot.target);

                if (bot.mesh.position.distanceTo(bot.target) < 1) {
                    bot.state = 'idle';
                    bot.idleUntil = now + Math.random() * 3000 + 1000;
                }
            }

            // Aim and shoot logic
            const distanceToPlayer = bot.mesh.position.distanceTo(player.position);
            if (distanceToPlayer < 50 && now - bot.lastShotTime > 2500) { // Cooldown
                const directionToPlayer = player.position.clone().sub(bot.mesh.position).normalize();
                spawnBlast(bot.mesh.position.clone().add(directionToPlayer), directionToPlayer, 0xffa500); // Orange blast
                bot.lastShotTime = now;
            }
        });
    };

    const animate = () => {
      animationFrameId.current = requestAnimationFrame(animate);
      
      const delta = clock.getDelta();
      const moveSpeed = 5 * delta;
      const player = localPlayerRef.current;
      
      if (player) {
        if (keysPressed.current['w']) player.translateZ(-moveSpeed);
        if (keysPressed.current['s']) player.translateZ(moveSpeed);
        if (keysPressed.current['a']) player.translateX(-moveSpeed);
        if (keysPressed.current['d']) player.translateX(moveSpeed);
        
        const offset = new THREE.Vector3(0, 4, 8);
        offset.applyQuaternion(player.quaternion);
        cameraRef.current.position.copy(player.position).add(offset);
        cameraRef.current.lookAt(player.position);
      }
      
      // Update bots
      updateBots(delta);

      // Update and cleanup blasts
      blastsRef.current = blastsRef.current.filter(blast => {
          blast.life -= delta;
          if (blast.life <= 0) {
              sceneRef.current.remove(blast.mesh);
              blast.mesh.geometry.dispose();
              (blast.mesh.material as THREE.Material).dispose();
              return false;
          }
          blast.mesh.position.add(blast.direction.clone().multiplyScalar(30 * delta));
          return true;
      });

      // Send player data to Firebase (throttled)
      const now = Date.now();
      if (playerId && player && now - lastUpdateTime > 100 && firebaseServiceRef.current) {
        firebaseServiceRef.current.updatePlayerPosition({
          id: playerId,
          x: player.position.x,
          y: player.position.y,
          z: player.position.z,
          rotY: player.rotation.y,
        });
        lastUpdateTime = now;
      }
      
      rendererRef.current?.render(sceneRef.current, cameraRef.current);
    };

    animate();
    
    return () => {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
    };
  }, [isLoading, error, playerId, spawnBlast]);

  return (
    <>
      {(isLoading || error) && (
        <div className="absolute inset-0 bg-black bg-opacity-80 flex items-center justify-center z-20">
            <div className="text-center text-white p-8 bg-gray-800 rounded-lg shadow-xl max-w-md mx-auto">
                {isLoading ? (
                    <>
                        <div className="w-16 h-16 border-4 border-dashed rounded-full animate-spin border-cyan-400 mx-auto"></div>
                        <p className="mt-4 text-xl">Connecting to Battle Arena...</p>
                    </>
                ) : ( // error must be non-null here
                    <>
                        <h2 className="text-2xl font-bold text-red-500 mb-4">Connection Failed</h2>
                        <p className="text-base text-gray-300">{error}</p>
                        <p className="text-sm text-gray-400 mt-6">
                            This usually means the Firebase environment variables are not set. Please check your project configuration.
                        </p>
                    </>
                )}
            </div>
        </div>
      )}
      <div ref={mountRef} className="w-full h-full" style={{ visibility: isLoading || error ? 'hidden' : 'visible' }}/>
      <button 
        onClick={fireBlast}
        className="fixed bottom-5 right-5 z-10 px-6 py-3 bg-cyan-500 text-black font-bold rounded-lg shadow-lg shadow-cyan-500/50 hover:bg-cyan-400 transform hover:scale-105 transition-all duration-200"
      >
        FIRE KI BLAST (F)
      </button>
    </>
  );
};

export default GameCanvas;
