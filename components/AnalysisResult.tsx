import React, { useState, useEffect, useRef } from 'react';
import { SongAnalysis, ChordEvent, AudioMetadata, AnalysisLevel } from '../types';

interface AnalysisResultProps {
  analysis: SongAnalysis | null;
  metadata: AudioMetadata | null;
}

// --- UTILS ---
const cleanStr = (str: any) => {
  if (!str) return '';
  const s = String(str).trim();
  if (['none', 'null', 'undefined', 'n/a', 'nan', 'NONE', 'NULL'].includes(s)) return '';
  return s;
};

const getDisplayChord = (chord: ChordEvent, level: AnalysisLevel): string => {
  const root = cleanStr(chord.root);
  let quality = cleanStr(chord.quality).toLowerCase();
  let extension = cleanStr(chord.extension);
  let bass = cleanStr(chord.bass);
  const symbol = cleanStr(chord.symbol);
  
  // Normalize quality
  if (quality === 'minor' || quality === 'min') quality = 'm';
  if (quality === 'major' || quality === 'maj') quality = ''; 
  if (quality === 'dominant' || quality === 'dom') quality = ''; 
  
  // --- BASIC MODE: STRICT TRIADS ONLY ---
  if (level === 'Basic') {
     // If it's diminished or augmented, keep that info as it's critical for function
     if (quality === 'dim' || quality === 'aug') return `${root}${quality}`;
     // Otherwise, strictly Root + m (if minor)
     // No 7ths, no slash bass
     return `${root}${quality === 'm' ? 'm' : ''}`; 
  }
  
  // --- ADVANCED/INTERMEDIATE ---
  if (symbol && symbol.length < 15 && !symbol.toLowerCase().includes('none')) {
      return symbol;
  }

  return `${root}${quality}${extension}${bass && bass !== root ? `/${bass}` : ''}`;
};

// --- Player & Grid Component ---
const ChordPlayer: React.FC<{ 
  audioUrl?: string, 
  duration: number, 
  analysis: SongAnalysis 
}> = ({ audioUrl, duration, analysis }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);
  
  // Player State
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [complexity, setComplexity] = useState<AnalysisLevel>('Advanced');

  const FIXED_PPS = 120; 

  useEffect(() => {
    let animationFrameId: number;
    const update = () => {
      if (audioRef.current) {
        setCurrentTime(audioRef.current.currentTime);
      }
      if (isPlaying) {
        animationFrameId = requestAnimationFrame(update);
      }
    };
    if (isPlaying) {
      animationFrameId = requestAnimationFrame(update);
    }
    return () => cancelAnimationFrame(animationFrameId);
  }, [isPlaying]);

  // --- INTERNAL SCROLL LOGIC ---
  useEffect(() => {
    if (isPlaying && gridContainerRef.current) {
      const activeIndex = analysis.chords?.findIndex(
        c => currentTime >= c.seconds && currentTime < (c.seconds + c.duration)
      );

      if (activeIndex !== -1 && activeIndex !== undefined) {
        const activeCard = cardRefs.current[activeIndex];
        const container = gridContainerRef.current;

        if (activeCard && container) {
           // Scroll ONLY the grid container, vertically centered
           // We calculate the position needed to center the card within the visible container area
           const cardTop = activeCard.offsetTop;
           const cardHeight = activeCard.clientHeight;
           const containerHeight = container.clientHeight;
           
           container.scrollTo({
             top: cardTop - (containerHeight / 2) + (cardHeight / 2),
             behavior: 'smooth'
           });
        }
      }
    }
  }, [currentTime, isPlaying, analysis.chords]);

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) audioRef.current.pause();
      else audioRef.current.play();
      setIsPlaying(!isPlaying);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const activeChord = analysis.chords?.find(c => currentTime >= c.seconds && currentTime < (c.seconds + c.duration));

  return (
    <div className="w-full max-w-7xl mx-auto space-y-8">
      
      {/* 1. TIMELINE & PLAYER */}
      <div className="bg-slate-900 rounded-3xl border border-slate-700 overflow-hidden shadow-2xl relative z-20">
        <audio 
            ref={audioRef} 
            src={audioUrl} 
            onEnded={() => setIsPlaying(false)} 
            onTimeUpdate={(e) => { if(!isPlaying) setCurrentTime(e.currentTarget.currentTime); }}
        />

        {/* Visualizer */}
        <div className="relative bg-slate-950 h-48 sm:h-64 overflow-hidden border-b border-slate-800 select-none">
             <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-indigo-500 z-30 shadow-[0_0_15px_indigo]"></div>
             
             <div 
               className="absolute top-0 bottom-0 left-1/2 will-change-transform"
               style={{ transform: `translate3d(${-currentTime * FIXED_PPS}px, 0, 0)` }}
             >
                <div className="absolute top-0 h-6 flex">
                    {analysis.sections?.map((section, i) => (
                        <div key={i} 
                            className="h-full px-2 text-[9px] font-bold uppercase flex items-center text-white/80 border-r border-white/10 truncate whitespace-nowrap"
                            style={{ 
                                left: `${section.startTime * FIXED_PPS}px`, 
                                width: `${(section.endTime - section.startTime) * FIXED_PPS}px`,
                                position: 'absolute',
                                backgroundColor: section.color || '#334155'
                            }}
                        >
                            {section.name}
                        </div>
                    ))}
                </div>

                <div className="absolute top-8 bottom-0 flex">
                    {analysis.chords?.map((chord, i) => (
                        <div key={i}
                             className={`absolute top-0 bottom-0 border-r border-white/5 flex items-center justify-center transition-opacity ${activeChord === chord ? 'opacity-100 bg-white/5' : 'opacity-40'}`}
                             style={{
                                 left: `${chord.seconds * FIXED_PPS}px`,
                                 width: `${Math.max(chord.duration * FIXED_PPS, 2)}px`
                             }}
                        >
                            <span className="text-lg sm:text-2xl font-bold text-white/30 truncate px-1">
                                {getDisplayChord(chord, 'Basic')}
                            </span>
                        </div>
                    ))}
                </div>
             </div>
             
             <div className="absolute inset-y-0 left-0 w-1/4 bg-gradient-to-r from-slate-900 via-slate-900/80 to-transparent z-20 pointer-events-none"></div>
             <div className="absolute inset-y-0 right-0 w-1/4 bg-gradient-to-l from-slate-900 via-slate-900/80 to-transparent z-20 pointer-events-none"></div>
        </div>

        {/* Controls */}
        <div className="p-4 bg-slate-900 flex flex-col gap-4">
             <div className="flex items-center gap-4">
                <span className="text-xs font-mono text-slate-400 w-10 text-right">{Math.floor(currentTime/60)}:{Math.floor(currentTime%60).toString().padStart(2,'0')}</span>
                <input 
                  type="range" min={0} max={duration} step={0.05} 
                  value={currentTime} onChange={handleSeek}
                  className="flex-1 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500 hover:accent-indigo-400"
                />
                <span className="text-xs font-mono text-slate-400 w-10">{Math.floor(duration/60)}:{Math.floor(duration%60).toString().padStart(2,'0')}</span>
             </div>

             <div className="flex justify-between items-center">
                 <div className="flex items-center gap-4">
                     <button onClick={togglePlay} className="w-12 h-12 bg-white rounded-full flex items-center justify-center text-black hover:scale-105 transition shadow-lg shadow-white/10 active:scale-95">
                        {isPlaying ? <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg> : <svg className="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>}
                     </button>
                     <div>
                        <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Now Playing</div>
                        <div className="text-white font-bold text-xl sm:text-2xl leading-none mt-1">
                            {activeChord ? getDisplayChord(activeChord, complexity) : '--'}
                        </div>
                     </div>
                 </div>
                 
                 <div className="flex items-center gap-3">
                     <div className="flex flex-col items-end">
                        <span className="text-[10px] font-bold text-slate-500 uppercase">Speed</span>
                        <div className="flex bg-slate-800 rounded-lg p-0.5 mt-0.5">
                            {[0.5, 0.75, 1.0].map(r => (
                                <button key={r} onClick={() => { setPlaybackRate(r); if(audioRef.current) audioRef.current.playbackRate = r; }}
                                    className={`px-2 py-1 text-[10px] rounded font-bold transition-colors ${playbackRate === r ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>
                                    {r}x
                                </button>
                            ))}
                        </div>
                     </div>
                 </div>
             </div>
        </div>
      </div>

      {/* 2. CHORD GRID (Independent Scroll) */}
      <div className="bg-slate-950/50 p-6 rounded-3xl border border-slate-800/50 relative z-10">
          <div className="flex justify-between items-end mb-6">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <svg className="w-5 h-5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
                Harmonic Grid
              </h2>
              <div className="flex bg-slate-900 rounded-lg p-1">
                 {(['Basic', 'Intermediate', 'Advanced'] as AnalysisLevel[]).map(lvl => (
                    <button key={lvl} onClick={() => setComplexity(lvl)}
                        className={`px-3 py-1 text-[10px] rounded uppercase font-bold tracking-wider transition-all ${complexity === lvl ? 'bg-indigo-500/20 text-indigo-300 shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}>
                        {lvl}
                    </button>
                 ))}
              </div>
          </div>

          <div 
             ref={gridContainerRef}
             className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3 max-h-[400px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-indigo-900 scrollbar-track-slate-900 scroll-smooth relative"
          >
             {analysis.chords?.map((chord, i) => {
                 const isActive = activeChord === chord;
                 const chordLabel = getDisplayChord(chord, complexity);
                 const root = cleanStr(chord.root);
                 
                 return (
                     <button 
                        key={i}
                        ref={(el) => { cardRefs.current[i] = el; }}
                        onClick={() => {
                            if(audioRef.current) {
                                audioRef.current.currentTime = chord.seconds;
                                setCurrentTime(chord.seconds);
                            }
                        }}
                        className={`
                           relative group text-left p-3 rounded-xl border transition-all duration-300
                           ${isActive 
                             ? 'bg-indigo-900/40 border-indigo-500 shadow-[0_0_20px_rgba(99,102,241,0.25)] ring-1 ring-indigo-400/30 scale-[1.02] z-10' 
                             : 'bg-slate-900 border-slate-800 hover:border-slate-600 hover:bg-slate-800'
                           }
                        `}
                     >
                        <div className="flex justify-between items-start mb-2">
                            <span className={`text-[10px] font-mono ${isActive ? 'text-indigo-300' : 'text-slate-500'}`}>
                                {chord.timestamp}
                            </span>
                        </div>

                        <div className={`text-2xl font-black mb-1 tracking-tight truncate ${isActive ? 'text-white' : 'text-indigo-400'}`}>
                            {chordLabel}
                        </div>

                        {complexity !== 'Basic' && (
                             <div className="flex flex-col gap-0.5">
                                 {cleanStr(chord.bass) && cleanStr(chord.bass) !== root && (
                                     <span className="text-[10px] font-bold text-slate-400">
                                         Bass: <span className="text-slate-200">{cleanStr(chord.bass)}</span>
                                     </span>
                                 )}
                             </div>
                        )}
                        
                        {isActive && (
                             <div className="absolute bottom-0 left-0 h-1 bg-indigo-500 transition-all duration-75 rounded-b-xl"
                                  style={{ width: `${Math.min(100, ((currentTime - chord.seconds) / chord.duration) * 100)}%` }}
                             />
                        )}
                     </button>
                 );
             })}
          </div>
      </div>

    </div>
  );
};

export const AnalysisResult: React.FC<AnalysisResultProps> = ({ analysis, metadata }) => {
  if (!analysis) return null;

  return (
    <div className="w-full animate-fade-in pb-20">
       <div className="text-center mb-12">
          <h1 className="text-4xl font-black text-white mb-2 tracking-tight">{analysis.title || "Untitled Track"}</h1>
          <p className="text-xl text-indigo-400 font-bold mb-6">{analysis.artist || "Unknown Artist"}</p>
          
          <div className="inline-flex flex-wrap justify-center gap-3 sm:gap-6">
              <div className="bg-slate-900/80 backdrop-blur border border-slate-700/50 px-5 py-3 rounded-2xl text-center min-w-[100px] shadow-lg">
                 <div className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">Key Center</div>
                 <div className="text-white font-black text-lg">{analysis.key}</div>
              </div>
              <div className="bg-slate-900/80 backdrop-blur border border-slate-700/50 px-5 py-3 rounded-2xl text-center min-w-[100px] shadow-lg">
                 <div className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">Tempo</div>
                 <div className="text-white font-black text-lg">{analysis.bpm} <span className="text-xs text-slate-500 font-normal">BPM</span></div>
              </div>
               <div className="bg-slate-900/80 backdrop-blur border border-slate-700/50 px-5 py-3 rounded-2xl text-center min-w-[100px] shadow-lg">
                 <div className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">Time Sig</div>
                 <div className="text-white font-black text-lg">{analysis.timeSignature}</div>
              </div>
              <div className="bg-slate-900/80 backdrop-blur border border-slate-700/50 px-5 py-3 rounded-2xl text-center min-w-[100px] shadow-lg">
                 <div className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">Complexity</div>
                 <div className="text-white font-black text-lg">{analysis.complexityLevel}</div>
              </div>
          </div>
          
          {analysis.summary && (
            <div className="mt-8 max-w-3xl mx-auto">
                <p className="text-slate-400 text-sm leading-relaxed italic opacity-80">
                   "{analysis.summary}"
                </p>
            </div>
          )}
       </div>

       <ChordPlayer 
          analysis={analysis} 
          audioUrl={metadata?.audioUrl} 
          duration={metadata?.duration || 0} 
       />
    </div>
  );
};