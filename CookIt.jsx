import { useState, useRef } from "react";
import { ChevronLeft, ChevronRight, X, Plus, Clock, Check, Users, AlertCircle, Camera, Mic, Loader2, UtensilsCrossed } from "lucide-react";

const MODEL = "claude-sonnet-4-6";
const SUGGESTIONS = ["Ei", "Nudeln", "Reis", "Kartoffeln", "Zwiebel", "Knoblauch", "Tomaten", "Paprika", "Karotten", "Champignons", "Käse", "Milch", "Hähnchen", "Hackfleisch", "Speck", "Butter"];
const DIFF_LEVEL = { Einfach: 1, Mittel: 2, Anspruchsvoll: 3 };

async function askClaude(prompt) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok) throw new Error("network");
  const data = await response.json();
  const text = (data.content || [])
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n");
  const cleaned = text.replace(/```json|```/g, "").trim();
  const match = cleaned.match(/[\[{][\s\S]*[\]}]/);
  return JSON.parse(match ? match[0] : cleaned);
}

async function askClaudeVision(base64Data, mediaType, prompt) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1000,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64Data } },
            { type: "text", text: prompt },
          ],
        },
      ],
    }),
  });
  if (!response.ok) throw new Error("network");
  const data = await response.json();
  const text = (data.content || [])
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n");
  const cleaned = text.replace(/```json|```/g, "").trim();
  const match = cleaned.match(/\[[\s\S]*\]/);
  return JSON.parse(match ? match[0] : cleaned);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

function DifficultyBars({ level }) {
  const filled = DIFF_LEVEL[level] || 1;
  return (
    <span className="cookit-diff">
      {[0, 1, 2].map((i) => (
        <span key={i} className={`cookit-diff-bar${i < filled ? " filled" : ""}`} style={{ height: 5 + i * 3 }} />
      ))}
    </span>
  );
}

export default function CookIt() {
  const [screen, setScreen] = useState("input");
  const [ingredients, setIngredients] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [recipes, setRecipes] = useState([]);
  const [detail, setDetail] = useState(null);
  const [doneSteps, setDoneSteps] = useState({});
  const [errorFrom, setErrorFrom] = useState("input");
  const [photoState, setPhotoState] = useState("idle");
  const [voiceState, setVoiceState] = useState("idle");
  const inputRef = useRef(null);
  const photoInputRef = useRef(null);

  function commitIngredients(names) {
    setIngredients((prev) => {
      const existing = new Set(prev.map((p) => p.toLowerCase()));
      const fresh = names.filter((n) => n && !existing.has(String(n).toLowerCase()));
      return [...prev, ...fresh];
    });
  }

  function addIngredient() {
    const parts = inputValue.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) return;
    commitIngredients(parts);
    setInputValue("");
    inputRef.current?.focus();
  }

  function addSuggested(name) {
    commitIngredients([name]);
  }

  function removeIngredient(idx) {
    setIngredients((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleKeyDown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      addIngredient();
    }
  }

  function triggerPhotoInput() {
    photoInputRef.current?.click();
  }

  async function handlePhotoChange(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setPhotoState("loading");
    try {
      const base64 = await fileToBase64(file);
      const prompt = 'Schau dir dieses Foto an und identifiziere alle sichtbaren Lebensmittel-Zutaten. Antworte NUR mit einem validen JSON-Array aus kurzen deutschen Zutat-Bezeichnungen, ohne Markdown, ohne Codeblock, ohne Erklärung. Beispiel: ["Tomate","Zwiebel","Ei"]. Falls keine Zutaten erkennbar sind, antworte mit [].';
      const result = await askClaudeVision(base64, file.type || "image/jpeg", prompt);
      if (Array.isArray(result) && result.length > 0) {
        commitIngredients(result);
        setPhotoState("idle");
      } else {
        setPhotoState("empty");
      }
    } catch (err) {
      setPhotoState("error");
    }
  }

  function startVoiceInput() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setVoiceState("unsupported");
      return;
    }
    try {
      const recognition = new SpeechRecognition();
      recognition.lang = "de-DE";
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.onstart = () => setVoiceState("listening");
      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        const parts = transcript.split(/,| und /gi).map((p) => p.trim()).filter(Boolean);
        if (parts.length) commitIngredients(parts);
        setVoiceState("idle");
      };
      recognition.onerror = () => setVoiceState("error");
      recognition.onend = () => setVoiceState((s) => (s === "listening" ? "idle" : s));
      recognition.start();
    } catch (err) {
      setVoiceState("error");
    }
  }

  async function findRecipes() {
    setScreen("loading-recipes");
    try {
      const prompt = `Du bist ein Koch-Assistent. Ein Nutzer hat folgende Zutaten zur Verfügung: ${ingredients.join(
        ", "
      )}. Grundzutaten wie Salz, Pfeffer, Öl, Wasser, Zucker darfst du zusätzlich voraussetzen. Schlage genau 4 unterschiedliche, alltagstaugliche Gerichte vor, sortiert vom am besten passenden zum am wenigsten passenden. Antworte NUR mit einem validen JSON-Array, ohne Markdown, ohne Codeblock, ohne Erklärung, in exakt diesem Format: [{"id":"1","title":"Gerichtname","description":"kurze, konkrete Beschreibung, max. 10 Wörter","time":"z.B. 20 Min.","difficulty":"Einfach","servings":"2 Portionen"}]. Die difficulty ist immer eines von: Einfach, Mittel, Anspruchsvoll.`;
      const result = await askClaude(prompt);
      if (!Array.isArray(result) || result.length === 0) throw new Error("empty");
      setRecipes(result);
      setScreen("options");
    } catch (e) {
      setErrorFrom("input");
      setScreen("error");
    }
  }

  async function selectRecipe(recipe) {
    setScreen("loading-detail");
    try {
      const prompt = `Erstelle eine Kochanleitung für "${recipe.title}" (${recipe.description}). Verfügbare Zutaten: ${ingredients.join(
        ", "
      )}. Grundzutaten wie Salz, Pfeffer, Öl, Wasser, Zucker darfst du zusätzlich voraussetzen. Antworte NUR mit validem JSON, ohne Markdown, ohne Codeblock, ohne Erklärung, in exakt diesem Format: {"title":"${recipe.title}","time":"${recipe.time}","difficulty":"${recipe.difficulty}","servings":"${recipe.servings}","ingredients":[{"name":"Zutat","amount":"Menge"}],"steps":[{"title":"kurzer Schritt-Titel","content":"konkrete, knappe Anweisung, 1-2 Sätze"}]}. Erstelle 4 bis 7 Schritte.`;
      const result = await askClaude(prompt);
      if (!result || !Array.isArray(result.steps)) throw new Error("empty");
      setDetail(result);
      setDoneSteps({});
      setScreen("detail");
    } catch (e) {
      setErrorFrom("options");
      setScreen("error");
    }
  }

  function toggleStep(idx) {
    setDoneSteps((prev) => ({ ...prev, [idx]: !prev[idx] }));
  }

  function resetAll() {
    setIngredients([]);
    setInputValue("");
    setRecipes([]);
    setDetail(null);
    setDoneSteps({});
    setPhotoState("idle");
    setVoiceState("idle");
    setScreen("input");
  }

  const availableSuggestions = SUGGESTIONS.filter(
    (s) => !ingredients.some((i) => i.toLowerCase() === s.toLowerCase())
  );

  const featured = recipes[0];
  const others = recipes.slice(1);
  const doneCount = detail ? Object.values(doneSteps).filter(Boolean).length : 0;
  const totalSteps = detail?.steps?.length || 0;
  const progressPct = totalSteps ? Math.round((doneCount / totalSteps) * 100) : 0;

  return (
    <div className="cookit-app">
      <style>{`
        .cookit-app {
          --bg: #FFFFFF;
          --bg-subtle: #F5F5F7;
          --black: #0A0A0A;
          --text-secondary: #6E6E73;
          --orange: #FF5A1F;
          --orange-dark: #E14A10;
          --orange-light: #FF6B36;
          --orange-tint: #FFF1E8;
          --border: #E7E7EA;
          --font: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Inter", "Helvetica Neue", Arial, sans-serif;

          font-family: var(--font);
          background: var(--bg-subtle);
          min-height: 100vh;
          display: flex;
          justify-content: center;
          box-sizing: border-box;
          color: var(--black);
          -webkit-font-smoothing: antialiased;
        }
        .cookit-app *, .cookit-app *::before, .cookit-app *::after { box-sizing: border-box; }
        .cookit-shell { width: 100%; max-width: 460px; background: var(--bg); min-height: 100vh; display: flex; flex-direction: column; }
        .cookit-screen { flex: 1; padding: 24px 22px 32px; animation: cookit-fade 0.32s ease both; display: flex; flex-direction: column; }
        @keyframes cookit-fade { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @media (prefers-reduced-motion: reduce) { .cookit-screen, .cookit-chip { animation: none !important; } }

        .cookit-topbar { display: flex; align-items: center; min-height: 32px; margin-bottom: 18px; }
        .cookit-back { display: flex; align-items: center; gap: 2px; background: none; border: none; color: var(--orange); font-size: 16px; font-weight: 600; font-family: var(--font); cursor: pointer; padding: 6px 4px 6px 0; margin-left: -4px; }
        .cookit-back:active { opacity: 0.5; }

        .cookit-brand { display: flex; align-items: center; gap: 8px; }
        .cookit-brand-icon { width: 28px; height: 28px; border-radius: 8px; background: var(--orange); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .cookit-brand-name { font-size: 17px; font-weight: 700; letter-spacing: -0.01em; }

        .cookit-hero { margin: 4px 0 26px; }
        .cookit-h1 { font-size: 30px; font-weight: 700; letter-spacing: -0.025em; line-height: 1.15; margin: 0 0 9px; }
        .cookit-sub { font-size: 16px; color: var(--text-secondary); line-height: 1.45; margin: 0; max-width: 32ch; }

        .cookit-input-row { display: flex; gap: 8px; margin-top: 24px; }
        .cookit-input { flex: 1; border: 1.5px solid var(--border); background: var(--bg-subtle); border-radius: 14px; padding: 14px 16px; font-size: 16px; font-family: var(--font); color: var(--black); outline: none; transition: border-color 0.15s ease, background 0.15s ease; }
        .cookit-input:focus { border-color: var(--orange); background: var(--bg); }
        .cookit-input::placeholder { color: #A9A9AE; }
        .cookit-add-btn { width: 48px; height: 48px; border-radius: 14px; background: var(--black); border: none; display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; transition: transform 0.1s ease, opacity 0.15s ease; }
        .cookit-add-btn:active { transform: scale(0.92); }
        .cookit-add-btn:disabled { opacity: 0.3; cursor: not-allowed; }

        .cookit-action-row { display: flex; gap: 10px; margin-top: 10px; }
        .cookit-action-btn { flex: 1; display: flex; align-items: center; justify-content: center; gap: 7px; border: 1.5px solid var(--border); background: var(--bg); border-radius: 14px; padding: 12px; font-size: 14px; font-weight: 600; color: var(--black); cursor: pointer; font-family: var(--font); transition: border-color 0.15s ease, transform 0.1s ease, background 0.15s ease; }
        .cookit-action-btn:active { transform: scale(0.97); }
        .cookit-action-btn.listening { border-color: var(--orange); background: var(--orange-tint); color: var(--orange-dark); }
        .cookit-action-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .cookit-inline-note { font-size: 13px; color: var(--text-secondary); margin: 10px 2px 0; }
        .cookit-spin { animation: cookit-spin 0.9s linear infinite; }
        @keyframes cookit-spin { to { transform: rotate(360deg); } }

        .cookit-mini-label { font-size: 13px; font-weight: 600; color: var(--text-secondary); margin: 22px 0 10px; }
        .cookit-suggest-row { display: flex; flex-wrap: wrap; gap: 8px; }
        .cookit-suggest-chip { background: var(--bg); border: 1.5px solid var(--border); border-radius: 100px; padding: 7px 14px; font-size: 13.5px; font-weight: 600; color: var(--black); cursor: pointer; transition: border-color 0.15s ease, transform 0.1s ease; }
        .cookit-suggest-chip:active { transform: scale(0.94); border-color: var(--orange); }

        .cookit-chips { display: flex; flex-wrap: wrap; gap: 8px; }
        .cookit-chip { display: flex; align-items: center; gap: 6px; background: var(--orange-tint); color: var(--orange-dark); border-radius: 100px; padding: 8px 8px 8px 14px; font-size: 14.5px; font-weight: 600; animation: cookit-pop 0.2s ease both; }
        @keyframes cookit-pop { from { transform: scale(0.85); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        .cookit-chip button { background: rgba(255,90,31,0.16); border: none; border-radius: 100px; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--orange-dark); padding: 0; }
        .cookit-chip button:active { opacity: 0.5; }

        .cookit-spacer { flex: 1; min-height: 20px; }

        .cookit-cta { width: 100%; border: none; border-radius: 16px; background: linear-gradient(180deg, var(--orange-light), var(--orange)); color: white; font-size: 17px; font-weight: 700; font-family: var(--font); padding: 17px; cursor: pointer; margin-top: 26px; box-shadow: 0 12px 22px rgba(255,90,31,0.32); transition: transform 0.1s ease, box-shadow 0.15s ease; }
        .cookit-cta:active { transform: scale(0.98); box-shadow: 0 6px 14px rgba(255,90,31,0.28); }
        .cookit-cta:disabled { background: var(--border); color: #A9A9AE; cursor: not-allowed; box-shadow: none; }

        .cookit-ghost-btn { width: 100%; border: 1.5px solid var(--border); border-radius: 16px; background: var(--bg); color: var(--black); font-size: 16px; font-weight: 600; font-family: var(--font); padding: 15px; cursor: pointer; transition: transform 0.1s ease, border-color 0.15s ease; }
        .cookit-ghost-btn:active { transform: scale(0.98); border-color: var(--black); }

        .cookit-loading { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 20px; padding: 40px; text-align: center; }
        .cookit-dots { display: flex; gap: 9px; }
        .cookit-dot { width: 11px; height: 11px; border-radius: 50%; background: var(--orange); animation: cookit-bounce 0.9s ease-in-out infinite; }
        .cookit-dot:nth-child(2) { animation-delay: 0.15s; }
        .cookit-dot:nth-child(3) { animation-delay: 0.3s; }
        @keyframes cookit-bounce { 0%, 80%, 100% { transform: scale(0.6); opacity: 0.5; } 40% { transform: scale(1); opacity: 1; } }
        .cookit-loading-text { font-size: 16px; font-weight: 600; color: var(--text-secondary); }

        .cookit-section-label { font-size: 20px; font-weight: 700; letter-spacing: -0.01em; margin: 0 0 16px; }
        .cookit-list-label { font-size: 14px; font-weight: 600; color: var(--text-secondary); margin: 28px 0 4px; }

        .cookit-featured-tag { font-size: 13px; font-weight: 600; color: var(--orange); margin: 6px 0 10px; }
        .cookit-featured-card { text-align: left; width: 100%; border: none; border-radius: 22px; padding: 22px; background: linear-gradient(155deg, #171717, var(--black)); cursor: pointer; transition: transform 0.1s ease; font-family: var(--font); }
        .cookit-featured-card:active { transform: scale(0.98); }
        .cookit-featured-title { font-size: 21px; font-weight: 700; color: white; margin: 0 0 6px; letter-spacing: -0.01em; }
        .cookit-featured-desc { font-size: 14.5px; color: rgba(255,255,255,0.65); margin: 0 0 18px; line-height: 1.4; }
        .cookit-featured-badges { display: flex; gap: 8px; flex-wrap: wrap; }
        .cookit-featured-badge { display: flex; align-items: center; gap: 6px; background: rgba(255,255,255,0.12); border-radius: 100px; padding: 6px 12px; font-size: 12.5px; font-weight: 600; color: white; }

        .cookit-list-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; text-align: left; padding: 15px 2px; border: none; border-bottom: 1px solid var(--border); background: none; cursor: pointer; font-family: var(--font); }
        .cookit-list-row:last-child { border-bottom: none; }
        .cookit-list-row:active { opacity: 0.55; }
        .cookit-row-title { font-size: 16px; font-weight: 600; margin: 0 0 5px; }
        .cookit-row-meta { display: flex; align-items: center; gap: 10px; font-size: 12.5px; font-weight: 600; color: var(--text-secondary); }
        .cookit-row-meta-item { display: flex; align-items: center; gap: 4px; }

        .cookit-diff { display: flex; align-items: flex-end; gap: 3px; }
        .cookit-diff-bar { width: 4px; border-radius: 2px; background: rgba(255,255,255,0.3); }
        .cookit-diff-bar.filled { background: var(--orange); }
        .cookit-row-meta .cookit-diff-bar { background: var(--border); }
        .cookit-row-meta .cookit-diff-bar.filled { background: var(--orange); }

        .cookit-detail-badges { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0 24px; }
        .cookit-badge { display: flex; align-items: center; gap: 6px; background: var(--bg-subtle); border-radius: 100px; padding: 7px 12px; font-size: 13px; font-weight: 600; color: var(--black); }

        .cookit-progress-wrap { margin: 0 0 28px; }
        .cookit-progress-track { height: 6px; background: var(--bg-subtle); border-radius: 100px; overflow: hidden; margin-bottom: 8px; }
        .cookit-progress-fill { height: 100%; background: var(--orange); border-radius: 100px; transition: width 0.25s ease; }
        .cookit-progress-text { font-size: 13px; font-weight: 600; color: var(--text-secondary); }

        .cookit-ing-list { display: flex; flex-direction: column; gap: 12px; margin-bottom: 30px; }
        .cookit-ing-row { display: flex; align-items: baseline; gap: 10px; font-size: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--border); }
        .cookit-ing-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--orange); flex-shrink: 0; margin-bottom: 2px; }
        .cookit-ing-name { flex: 1; font-weight: 500; }
        .cookit-ing-amount { color: var(--text-secondary); font-weight: 500; }

        .cookit-steps { display: flex; flex-direction: column; gap: 2px; }
        .cookit-step { display: flex; gap: 14px; padding: 14px 0; }
        .cookit-step-num { width: 30px; height: 30px; border-radius: 50%; background: var(--orange); color: white; font-weight: 700; font-size: 14px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: background 0.15s ease; }
        .cookit-step-num.done { background: var(--black); }
        .cookit-step-body { flex: 1; cursor: pointer; }
        .cookit-step-title { font-size: 16px; font-weight: 700; margin: 0 0 4px; transition: opacity 0.15s ease; }
        .cookit-step-content { font-size: 15px; color: var(--text-secondary); line-height: 1.5; margin: 0; transition: opacity 0.15s ease; }
        .cookit-step.done .cookit-step-title, .cookit-step.done .cookit-step-content { opacity: 0.4; }
        .cookit-step-check { width: 26px; height: 26px; border-radius: 50%; border: 1.5px solid var(--border); background: var(--bg); display: flex; align-items: center; justify-content: center; flex-shrink: 0; cursor: pointer; margin-top: 2px; transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease; }
        .cookit-step-check.done { background: var(--orange); border-color: var(--orange); transform: scale(1.05); }

        .cookit-error { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 6px; padding: 40px; }
        .cookit-error-title { font-size: 19px; font-weight: 700; margin: 14px 0 0; }
        .cookit-error-text { font-size: 15px; color: var(--text-secondary); margin: 0 0 14px; max-width: 30ch; }
        .cookit-error .cookit-cta { width: auto; padding: 13px 30px; margin-top: 0; }
      `}</style>

      <div className="cookit-shell">
        {screen === "input" && (
          <div className="cookit-screen">
            <div className="cookit-topbar">
              <div className="cookit-brand">
                <div className="cookit-brand-icon"><UtensilsCrossed size={15} color="white" strokeWidth={2.3} /></div>
                <span className="cookit-brand-name">CookIt</span>
              </div>
            </div>

            <div className="cookit-hero">
              <h1 className="cookit-h1">Was hast du zu Hause?</h1>
              <p className="cookit-sub">Zutaten eingeben, fotografieren oder ansagen — wir finden passende Gerichte dazu.</p>
            </div>

            <div className="cookit-input-row">
              <input
                ref={inputRef}
                className="cookit-input"
                placeholder="z. B. Tomaten, Eier, Reis"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
              />
              <button className="cookit-add-btn" onClick={addIngredient} disabled={!inputValue.trim()}>
                <Plus size={20} color="white" strokeWidth={2.5} />
              </button>
            </div>

            <div className="cookit-action-row">
              <button className="cookit-action-btn" onClick={triggerPhotoInput} disabled={photoState === "loading"}>
                {photoState === "loading" ? <Loader2 size={17} className="cookit-spin" /> : <Camera size={17} strokeWidth={2.2} />}
                <span>Fotografieren</span>
              </button>
              <button
                className={`cookit-action-btn${voiceState === "listening" ? " listening" : ""}`}
                onClick={startVoiceInput}
                disabled={voiceState === "listening"}
              >
                <Mic size={17} strokeWidth={2.2} />
                <span>{voiceState === "listening" ? "Ich höre …" : "Diktieren"}</span>
              </button>
            </div>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: "none" }}
              onChange={handlePhotoChange}
            />

            {photoState === "error" && <p className="cookit-inline-note">Zutaten im Foto konnten nicht erkannt werden. Versuch's erneut.</p>}
            {photoState === "empty" && <p className="cookit-inline-note">Im Foto wurden keine Zutaten erkannt.</p>}
            {voiceState === "unsupported" && <p className="cookit-inline-note">Spracheingabe wird auf diesem Gerät nicht unterstützt.</p>}
            {voiceState === "error" && <p className="cookit-inline-note">Zugriff auf das Mikrofon war nicht möglich.</p>}

            {availableSuggestions.length > 0 && (
              <>
                <p className="cookit-mini-label">Schnell hinzufügen</p>
                <div className="cookit-suggest-row">
                  {availableSuggestions.map((s) => (
                    <button className="cookit-suggest-chip" key={s} onClick={() => addSuggested(s)}>
                      + {s}
                    </button>
                  ))}
                </div>
              </>
            )}

            {ingredients.length > 0 && (
              <>
                <p className="cookit-mini-label">Deine Zutaten</p>
                <div className="cookit-chips">
                  {ingredients.map((ing, idx) => (
                    <div className="cookit-chip" key={ing + idx}>
                      <span>{ing}</span>
                      <button onClick={() => removeIngredient(idx)}><X size={12} strokeWidth={3} /></button>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="cookit-spacer" />

            <button className="cookit-cta" onClick={findRecipes} disabled={ingredients.length === 0}>
              Rezepte finden
            </button>
          </div>
        )}

        {screen === "loading-recipes" && (
          <div className="cookit-loading">
            <div className="cookit-dots"><span className="cookit-dot" /><span className="cookit-dot" /><span className="cookit-dot" /></div>
            <p className="cookit-loading-text">Suche passende Rezepte …</p>
          </div>
        )}

        {screen === "options" && (
          <div className="cookit-screen">
            <div className="cookit-topbar">
              <button className="cookit-back" onClick={resetAll}><ChevronLeft size={20} strokeWidth={2.5} />Zutaten</button>
            </div>

            <h1 className="cookit-h1" style={{ fontSize: 24, margin: "10px 0 4px" }}>{recipes.length} Ideen für dich</h1>
            <p className="cookit-sub" style={{ fontSize: 14.5 }}>Sortiert nach der besten Übereinstimmung mit deinen Zutaten.</p>

            {featured && (
              <>
                <p className="cookit-featured-tag">Top-Empfehlung</p>
                <button className="cookit-featured-card" onClick={() => selectRecipe(featured)}>
                  <p className="cookit-featured-title">{featured.title}</p>
                  <p className="cookit-featured-desc">{featured.description}</p>
                  <div className="cookit-featured-badges">
                    <span className="cookit-featured-badge"><Clock size={12} strokeWidth={2.4} />{featured.time}</span>
                    <span className="cookit-featured-badge"><DifficultyBars level={featured.difficulty} />{featured.difficulty}</span>
                    {featured.servings && <span className="cookit-featured-badge"><Users size={12} strokeWidth={2.4} />{featured.servings}</span>}
                  </div>
                </button>
              </>
            )}

            {others.length > 0 && (
              <>
                <p className="cookit-list-label">Weitere Ideen</p>
                <div>
                  {others.map((r) => (
                    <button className="cookit-list-row" key={r.id} onClick={() => selectRecipe(r)}>
                      <div>
                        <p className="cookit-row-title">{r.title}</p>
                        <div className="cookit-row-meta">
                          <span className="cookit-row-meta-item"><Clock size={12} strokeWidth={2.4} />{r.time}</span>
                          <span className="cookit-row-meta-item"><DifficultyBars level={r.difficulty} />{r.difficulty}</span>
                        </div>
                      </div>
                      <ChevronRight size={18} color="var(--text-secondary)" />
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {screen === "loading-detail" && (
          <div className="cookit-loading">
            <div className="cookit-dots"><span className="cookit-dot" /><span className="cookit-dot" /><span className="cookit-dot" /></div>
            <p className="cookit-loading-text">Anleitung wird vorbereitet …</p>
          </div>
        )}

        {screen === "detail" && detail && (
          <div className="cookit-screen">
            <div className="cookit-topbar">
              <button className="cookit-back" onClick={() => setScreen("options")}><ChevronLeft size={20} strokeWidth={2.5} />Zurück</button>
            </div>

            <h1 className="cookit-h1" style={{ fontSize: 26, margin: "10px 0 0" }}>{detail.title}</h1>
            <div className="cookit-detail-badges">
              <span className="cookit-badge"><Clock size={13} strokeWidth={2.4} />{detail.time}</span>
              <span className="cookit-badge"><DifficultyBars level={detail.difficulty} />{detail.difficulty}</span>
              {detail.servings && <span className="cookit-badge"><Users size={13} strokeWidth={2.4} />{detail.servings}</span>}
            </div>

            {totalSteps > 0 && (
              <div className="cookit-progress-wrap">
                <div className="cookit-progress-track"><div className="cookit-progress-fill" style={{ width: `${progressPct}%` }} /></div>
                <span className="cookit-progress-text">{doneCount} von {totalSteps} Schritten erledigt</span>
              </div>
            )}

            <p className="cookit-section-label">Zutaten</p>
            <div className="cookit-ing-list">
              {(detail.ingredients || []).map((ing, idx) => (
                <div className="cookit-ing-row" key={idx}>
                  <span className="cookit-ing-dot" />
                  <span className="cookit-ing-name">{ing.name}</span>
                  <span className="cookit-ing-amount">{ing.amount}</span>
                </div>
              ))}
            </div>

            <p className="cookit-section-label">Zubereitung</p>
            <div className="cookit-steps">
              {(detail.steps || []).map((step, idx) => {
                const isDone = !!doneSteps[idx];
                return (
                  <div className={`cookit-step${isDone ? " done" : ""}`} key={idx}>
                    <div className={`cookit-step-num${isDone ? " done" : ""}`}>{idx + 1}</div>
                    <div className="cookit-step-body" onClick={() => toggleStep(idx)}>
                      <p className="cookit-step-title">{step.title}</p>
                      <p className="cookit-step-content">{step.content}</p>
                    </div>
                    <button className={`cookit-step-check${isDone ? " done" : ""}`} onClick={() => toggleStep(idx)}>
                      {isDone && <Check size={14} color="white" strokeWidth={3} />}
                    </button>
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: 26 }}>
              <button className="cookit-ghost-btn" onClick={resetAll}>Neue Zutaten eingeben</button>
            </div>
          </div>
        )}

        {screen === "error" && (
          <div className="cookit-error">
            <AlertCircle size={30} color="var(--black)" strokeWidth={1.8} />
            <p className="cookit-error-title">Das hat nicht geklappt</p>
            <p className="cookit-error-text">Die Verbindung ist fehlgeschlagen. Versuch es noch einmal.</p>
            <button className="cookit-cta" onClick={() => (errorFrom === "input" ? findRecipes() : setScreen("options"))}>
              Erneut versuchen
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
