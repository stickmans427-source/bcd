
import React from 'react';
import GameCanvas from './components/GameCanvas';

const App: React.FC = () => {
  return (
    <div className="relative h-screen w-screen overflow-hidden flex flex-col items-center justify-center bg-black">
      <div className="absolute top-0 left-0 p-4 z-10 text-white w-full bg-black bg-opacity-50">
        <h1 className="text-2xl md:text-4xl font-bold text-cyan-400 drop-shadow-[0_2px_2px_rgba(0,255,255,0.8)]">3D Multiplayer Battleground</h1>
        <p className="text-sm md:text-base text-gray-300">Move: WASD | Look: Click & Drag Mouse | Fire Ki Blast: F or Button</p>
      </div>
      
      <GameCanvas />
    </div>
  );
};

export default App;
