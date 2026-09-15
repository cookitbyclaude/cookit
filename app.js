const { useState, useRef } = React;

// Lucide Icons aus dem Browser-Objekt holen
const ChevronLeft = () => <i data-lucide="chevron-left"></i>;
const ChevronRight = () => <i data-lucide="chevron-right"></i>;
const X = () => <i data-lucide="x"></i>;
const Plus = () => <i data-lucide="plus"></i>;
const Clock = () => <i data-lucide="clock"></i>;
const Check = () => <i data-lucide="check"></i>;
const AlertCircle = () => <i data-lucide="alert-circle"></i>;
const Camera = () => <i data-lucide="camera"></i>;
const Mic = () => <i data-lucide="mic"></i>;
const Loader2 = () => <i data-lucide="loader-2"></i>;
const UtensilsCrossed = () => <i data-lucide="utensils-crossed"></i>;
const Minus = () => <i data-lucide="minus"></i>;

const MODEL = "claude-sonnet-4-6";
const SUGGESTIONS = ["Ei", "Nudeln", "Reis", "Kartoffeln", "Zwiebel", "Knoblauch", "Tomaten", "Paprika", "Karotten", "Champignons", "Käse", "Milch", "Hähnchen", "Hackfleisch", "Speck", "Butter"];
const DIFF_LEVEL = { Einfach: 1, Mittel: 2, Anspruchsvoll: 3 };
const SEARCH_TOOLS = [{ type: "web_search_20250305", name: "web_search" }];

async function askClaude(prompt, withSearch = false) {
  const body = {
    model: MODEL,
    max_tokens: 1000,
    messages: [{ role: "user", content: prompt }],
  };
  if (withSearch) body.tools = SEARCH_TOOLS;
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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

function CookIt() {
  const [screen, setScreen] = useState("input");
  const [ingredients, setIngredients] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [servings, setServings] = useState(2);
  const [recipes, setRecipes] = useState([]);
  const [detail, setDetail] = useState(null);
  const [doneSteps, setDoneSteps] = useState({});
  const [errorFrom, setErrorFrom] = useState("input");
  const [photoState, setPhotoState] = useState("idle");
  const [voiceState, setVoiceState] = useState("idle");
  const inputRef = useRef(null);
  const photoInputRef = useRef(null);

  React.useEffect(() => {
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }, [screen, recipes, detail, ingredients, photoState, voiceState]);

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

  function decServings() {
    setServings((s) => Math.max(1, s - 1));
  }
  function incServings() {
    setServings((s) => Math.min(12, s + 1));
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
      const prompt = `Du bist ein erfahrener Koch-Assistent mit breitem Küchen-Wissen. Verfügbare Zutaten: ${ingredients.join(
        ", "
      )}. Grundzutaten wie Salz, Pfeffer, Öl, Wasser, Zucker, Mehl darfst du zusätzlich voraussetzen. Die Gerichte sollen für ${servings} Person(en) ausgelegt sein.

Schlage genau 4 UNTERSCHIEDLICHE Gerichte vor, die wirklich gut zu genau diesen Zutaten passen. Wähle bewusst verschiedene Gerichttypen und Küchenstile (z.B. Suppe, Auflauf, Curry, Salat, Pasta-Gericht, Eintopf, gefülltes Gericht, Gebäck, asiatisch, mediterran, deftig-herzhaft — was jeweils zu den konkreten Zutaten passt). Vermeide es, standardmäßig immer nur generische Gerichte wie "schnelle Pfanne" oder "Ofengemüse" vorzuschlagen — nutze diese nur, wenn sie wirklich die beste Wahl für die genannten Zutaten sind. Nutze die Websuche, um dich an echten, bekannten Rezepten zu orientieren, die zu der Zutatenkombination passen.

Antworte NUR mit einem validen JSON-Array, ohne Markdown, ohne Codeblock, ohne Erklärung, in exakt diesem Format: [{"id":"1","title":"Gerichtname","description":"kurze, konkrete Beschreibung, max. 10 Wörter","time":"z.B. 20 Min.","difficulty":"Einfach"}]. Die difficulty ist immer eines von: Einfach, Mittel, Anspruchsvoll.`;
      const result = await askClaude(prompt, true);
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
      )}. Grundzutaten wie Salz, Pfeffer, Öl, Wasser, Zucker, Mehl darfst du zusätzlich voraussetzen. Recherchiere bei Bedarf per Websuche nach einem echten, passenden Rezept dafür.

Die Zubereitung ist für genau ${servings} Person(en) ausgelegt. Berechne ALLE Zutatenmengen exakt und proportional für ${servings} Person(en), mit konkreten Einheiten (g, ml, Stück, EL, TL). Vermeide vage Angaben wie "etwas" oder "nach Bedarf" — nur bei reinen Würzzutaten zum Abschmecken (Salz, Pfeffer) ist "nach Geschmack" akzeptabel.

Antworte NUR mit validem JSON, ohne Markdown, ohne Codeblock, ohne Erklärung, in exakt diesem Format: {"title":"${recipe.title}","time":"${recipe.time}","difficulty":"${recipe.difficulty}","ingredients":[{"name":"Zutat","amount":"genaue Menge mit Einheit"}],"steps":[{"title":"kurzer Schritt-Titel","content":"konkrete, knappe Anweisung, 1-2 Sätze"}]}. Erstelle 4 bis 7 Schritte.`;
      const result = await askClaude(prompt, true);
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
          height: 100vh;
          display: flex;
          justify-content: center;
          box-sizing: border-box;
          color: var(--black);
          -webkit-font-smoothing: antialiased;
          overflow: hidden;
        }
        .cookit-app *, .cookit-app *::before, .cookit-app *::after { box-sizing: border-box; }
        .cookit-shell { width: 100%; max-width: 460px; background: var(--bg); height: 100%; display: flex; flex-direction: column; overflow: hidden; }

        .cookit-page { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; animation: cookit-fade 0.28s ease both; }
        @keyframes cookit-fade { from { opacity: 0; } to { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { .cookit-page, .cookit-chip { animation: none !important; } }

        .cookit-page-top { flex-shrink: 0; padding: 18px 22px 0; }
        .cookit-page-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 0 22px 14px; -webkit-overflow-scrolling: touch; }
        .cookit-page-footer { flex-shrink: 0; padding: 10px 22px 18px; }

        .cookit-topbar { display: flex; align-items: center; min-height: 28px; margin-bottom: 6px; }
        .cookit-back { display: flex; align-items: center; gap: 2px; background: none; border: none; color: var(--orange); font-size: 16px; font-weight: 600; font-family: var(--font); cursor: pointer; padding: 6px 4px 6px 0; margin-left: -4px; }
        .cookit-back:active { opacity: 0.5; }

        .cookit-brand { display: flex; align-items: center; gap: 8px; }
        .cookit-brand-icon { width: 26px; height: 26px; border-radius: 8px; background: var(--orange); display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: white; }
        .cookit-brand-name { font-size: 16px; font-weight: 700; letter-spacing: -0.01em; }

        .cookit-h1 { font-size: 25px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.15; margin: 6px 0 4px; }
        .cookit-sub { font-size: 14.5px; color: var(--text-secondary); line-height: 1.4; margin: 0; }

        .cookit-servings-row { display: flex; align-items: center; justify-content: space-between; margin: 14px 0 14px; padding: 11px 14px; background: var(--bg-subtle); border-radius: 14px; }
        .cookit-servings-label { font-size: 14.5px; font-weight: 600; }
        .cookit-stepper { display: flex; align-items: center; gap: 12px; }
        .cookit-stepper-btn { width: 26px; height: 26px; flex: 0 0 26px; border-radius: 50%; border: 1.5px solid var(--border); background: var(--bg); display: flex; align-items: center; justify-content: center; cursor: pointer; }
        .cookit-stepper-btn:active { transform: scale(0.9); }
        .cookit-stepper-btn:disabled { opacity: 0.3; cursor: not-allowed; }
        .cookit-stepper-count { min-width: 20px; text-align: center; font-size: 15px; font-weight: 700; }

        .cookit-input-row { display: flex; gap: 8px; margin-top: 4px; }
        .cookit-input { flex: 1; border: 1.5px solid var(--border); background: var(--bg-subtle); border-radius: 14px; padding: 13px 16px; font-size: 16px; font-family: var(--font); color: var(--black); outline: none; transition: border-color 0.15s ease, background 0.15s ease; }
        .cookit-input:focus { border-color: var(--orange); background: var(--bg); }
        .cookit-input::placeholder { color: #A9A9AE; }
        .cookit-add-btn { width: 46px; height: 46px; border-radius: 14px; background: var(--black); border: none; display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; transition: transform 0.1s ease, opacity 0.15s ease; color: white; }
        .cookit-add-btn:active { transform: scale(0.92); }
        .cookit-add-btn:disabled { opacity: 0.3; cursor: not-allowed; }

        .cookit-action-row { display: flex; gap: 10px; margin-top: 10px; }
        .cookit-action-btn { flex: 1; display: flex; align-items: center; justify-content: center; gap: 7px; border: 1.5px solid var(--border); background: var(--bg); border-radius: 14px; padding: 11px; font-size: 13.5px; font-weight: 600; color: var(--black); cursor: pointer; font-family: var(--font); transition: border-color 0.15s ease, transform 0.1s ease, background 0.15s ease; }
        .cookit-action-btn:active { transform: scale(0.97); }
        .cookit-action-btn.listening { border-color: var(--orange); background: var(--orange-tint); color: var(--orange-dark); }
        .cookit-action-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .cookit-inline-note { font-size: 12.5px; color: var(--text-secondary); margin: 8px 2px 0; }
        .cookit-spin { animation: cookit-spin 0.9s linear infinite; }
        @keyframes cookit-spin { to { transform: rotate(360deg); } }

        .cookit-mini-label { font-size: 12.5px; font-weight: 600; color: var(--text-secondary); margin: 14px 0 8px; }
        .cookit-suggest-row { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 2px; scrollbar-width: none; }
        .cookit-suggest-row::-webkit-scrollbar { display: none; }
        .cookit-suggest-chip { flex-shrink: 0; background: var(--bg); border: 1.5px solid var(--border); border-radius: 100px; padding: 7px 14px; font-size: 13px; font-weight: 600; color: var(--black); cursor: pointer; transition: border-color 0.15s ease, transform 0.1s ease; white-space: nowrap; }
        .cookit-suggest-chip:active { transform: scale(0.94); border-color: var(--orange); }

        .cookit-chips { display: flex; flex-wrap: wrap; gap: 8px; }
        .cookit-chip { display: flex; align-items: center; gap: 6px; background: var(--orange-tint); color: var(--orange-dark); border-radius: 100px; padding: 8px 8px 8px 14px; font-size: 14px; font-weight: 600; animation: cookit-pop 0.2s ease both; }
        @keyframes cookit-pop { from { transform: scale(0.85); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        .cookit-chip button { background: rgba(255,90,31,0.16); border: none; border-radius: 100px; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--orange-dark); padding: 0; }
        .cookit-chip button:active { opacity: 0.5; }

        .cookit-cta { width: 100%; border: none; border-radius: 16px; background: linear-gradient(180deg, var(--orange-light), var(--orange)); color: white; font-size: 16.5px; font-weight: 700; font-family: var(--font); padding: 16px; cursor: pointer; box-shadow: 0 10px 20px rgba(255,90,31,0.32); transition: transform 0.1s ease, box-shadow 0.15s ease; }
        .cookit-cta:active { transform: scale(0.98); box-shadow: 0 6px 14px rgba(255,90,31,0.28); }
        .cookit-cta:disabled { background: var(--border); color: #A9A9AE; cursor: not-allowed; box-shadow: none; }

        .cookit-ghost-btn { width: 100%; border: 1.5px solid var(--border); border-radius: 16px; background: var(--bg); color: var(--black); font-size: 15.5px; font-weight: 600; font-family: var(--font); padding: 14px; cursor: pointer; transition: transform 0.1s ease, border-color 0.15s ease; }
        .cookit-ghost-btn:active { transform: scale(0.98); border-color: var(--black); }

        .cookit-loading { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 20px; padding: 40px; text-align: center; }
        .cookit-dots { display: flex; gap: 9px; }
        .cookit-dot { width: 11px; height: 11px; border-radius: 50%; background: var(--orange); animation: cookit-bounce 0.9s ease-in-out infinite; }
        .cookit-dot:nth-child(2) { animation-delay: 0.15s; }
        .cookit-dot:nth-child(3) { animation-delay: 0.3s; }
        @keyframes cookit-bounce { 0%, 80%, 100% { transform: scale(0.6); opacity: 0.5; } 40% { transform: scale(1); opacity: 1; } }
        .cookit-loading-text { font-size: 16px; font-weight: 600; color: var(--text-secondary); }

        .cookit-featured-card { text-align: left; width: 100%; border: none; border-radius: 22px; padding: 20px; background: linear-gradient(155deg, #171717, var(--black)); cursor: pointer; transition: transform 0.1s ease; font-family: var(--font); }
        .cookit-featured-card:active { transform: scale(0.98); }
        .cookit-featured-title { font-size: 20px; font-weight: 700; color: white; margin: 0 0 6px; letter-spacing: -0.01em; }
        .cookit-featured-desc { font-size: 14px; color: rgba(255,255,255,0.7); margin: 0 0 16px; line-height: 1.35; }
        .cookit-featured-meta { display: flex; align-items: center; gap: 12px; color: rgba(255,255,255,0.9); font-size: 13px; font-weight: 600; }

        .cookit-card { text-align: left; width: 100%; border: 1.5px solid var(--border); border-radius: 18px; padding: 16px; background: var(--bg); cursor: pointer; margin-bottom: 10px; transition: transform 0.1s ease, border-color 0.15s ease; font-family: var(--font); }
        .cookit-card:active { transform: scale(0.98); border-color: var(--orange); }
        .cookit-card-title { font-size: 16.5px; font-weight: 700; margin: 0 0 4px; }
        .cookit-card-desc { font-size: 13.5px; color: var(--text-secondary); margin: 0 0 12px; line-height: 1.35; }
        .cookit-card-meta { display: flex; align-items: center; gap: 12px; font-size: 12.5px; font-weight: 600; color: var(--black); }

        .cookit-diff { display: inline-flex; align-items: flex-end; gap: 2px; margin-right: 4px; }
        .cookit-diff-bar { width: 3px; background: #D1D1D6; border-radius: 1px; }
        .cookit-diff-bar.filled { background: var(--orange); }

        .cookit-ing-box { background: var(--bg-subtle); border-radius: 18px; padding: 16px; margin-bottom: 20px; }
        .cookit-ing-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; }
        .cookit-ing-item { display: flex; flex-direction: column; }
        .cookit-ing-name { font-size: 14px; font-weight: 600; }
        .cookit-ing-amount { font-size: 13px; color: var(--text-secondary); }

        .cookit-step { display: flex; gap: 14px; padding: 16px; border: 1.5px solid var(--border); border-radius: 18px; background: var(--bg); margin-bottom: 10px; cursor: pointer; transition: border-color 0.15s ease, opacity 0.2s ease; }
        .cookit-step.done { opacity: 0.5; border-color: transparent; background: var(--bg-subtle); }
        .cookit-step-check { width: 22px; height: 22px; border-radius: 50%; border: 2px solid var(--border); display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 2px; }
        .cookit-step.done .cookit-step-check { background: var(--orange); border-color: var(--orange); color: white; }
        .cookit-step-title { font-size: 15px; font-weight: 700; margin: 0 0 4px; }
        .cookit-step.done .cookit-step-title { text-decoration: line-through; }
        .cookit-step-text { font-size: 14px; color: var(--text-secondary); margin: 0; line-height: 1.4; }

        .cookit-progress { height: 4px; background: var(--border); border-radius: 2px; overflow: hidden; margin-top: 10px; }
        .cookit-progress-bar { height: 100%; background: var(--orange); transition: width 0.3s ease; }
      `}</style>

      <div className="cookit-shell">
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: "none" }}
          onChange={handlePhotoChange}
        />

        {screen === "input" && (
          <div className="cookit-page">
            <div className="cookit-page-top">
              <div className="cookit-topbar">
                <div className="cookit-brand">
                  <div className="cookit-brand-icon"><UtensilsCrossed /></div>
                  <span className="cookit-brand-name">CookIt</span>
                </div>
              </div>
              <h1 className="cookit-h1">Was hast du da?</h1>
              <p className="cookit-sub">Gib deine Zutaten ein oder mache ein Foto von deinen Vorräten.</p>

              <div className="cookit-servings-row">
                <span className="cookit-servings-label">Portionen</span>
                <div className="cookit-stepper">
                  <button className="cookit-stepper-btn" onClick={decServings} disabled={servings <= 1}><Minus /></button>
                  <span className="cookit-stepper-count">{servings}</span>
                  <button className="cookit-stepper-btn" onClick={incServings} disabled={servings >= 12}><Plus /></button>
                </div>
              </div>

              <div className="cookit-input-row">
                <input
                  ref={inputRef}
                  type="text"
                  className="cookit-input"
                  placeholder="Zutat eingeben..."
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                />
                <button className="cookit-add-btn" onClick={addIngredient} disabled={!inputValue.trim()}><Plus /></button>
              </div>

              <div className="cookit-action-row">
                <button className="cookit-action-btn" onClick={triggerPhotoInput} disabled={photoState === "loading"}>
                  {photoState === "loading" ? <Loader2 className="cookit-spin" /> : <Camera />} Foto scannen
                </button>
                <button
                  className={`cookit-action-btn${voiceState === "listening" ? " listening" : ""}`}
                  onClick={startVoiceInput}
                >
                  {voiceState === "listening" ? <Loader2 className="cookit-spin" /> : <Mic />} Sprache
                </button>
              </div>

              {photoState === "empty" && <div className="cookit-inline-note">Keine Zutaten auf dem Foto erkannt.</div>}
              {photoState === "error" && <div className="cookit-inline-note">Foto konnte nicht analysiert werden.</div>}
              {voiceState === "unsupported" && <div className="cookit-inline-note">Spracherkennung wird nicht unterstützt.</div>}
              {voiceState === "error" && <div className="cookit-inline-note">Fehler bei der Spracherkennung.</div>}

              {availableSuggestions.length > 0 && (
                <div>
                  <div className="cookit-mini-label">Schnell auswählen</div>
                  <div className="cookit-suggest-row">
                    {availableSuggestions.map((item) => (
                      <button key={item} className="cookit-suggest-chip" onClick={() => addSuggested(item)}>
                        + {item}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="cookit-mini-label" style={{ marginTop: 18 }}>
                Eingegebene Zutaten ({ingredients.length})
              </div>
            </div>

            <div className="cookit-page-scroll">
              {ingredients.length === 0 ? (
                <div style={{ color: "var(--text-secondary)", fontSize: 14, paddingTop: 10 }}>
                  Noch keine Zutaten hinzugefügt.
                </div>
              ) : (
                <div className="cookit-chips">
                  {ingredients.map((ing, idx) => (
                    <div key={idx} className="cookit-chip">
                      <span>{ing}</span>
                      <button onClick={() => removeIngredient(idx)}><X /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="cookit-page-footer">
              <button className="cookit-cta" onClick={findRecipes} disabled={ingredients.length === 0}>
                Rezepte vorschlagen
              </button>
            </div>
          </div>
        )}

        {screen === "loading-recipes" && (
          <div className="cookit-loading">
            <div className="cookit-dots">
              <div className="cookit-dot" />
              <div className="cookit-dot" />
              <div className="cookit-dot" />
            </div>
            <div className="cookit-loading-text">Suche passende Rezepte...</div>
          </div>
        )}

        {screen === "options" && (
          <div className="cookit-page">
            <div className="cookit-page-top">
              <div className="cookit-topbar">
                <button className="cookit-back" onClick={() => setScreen("input")}>
                  <ChevronLeft /> Zutaten
                </button>
              </div>
              <h1 className="cookit-h1">Vorgeschlagene Gerichte</h1>
              <p className="cookit-sub">Wähle ein Rezept, das du kochen möchtest.</p>
            </div>

            <div className="cookit-page-scroll" style={{ paddingTop: 14 }}>
              {featured && (
                <div>
                  <div className="cookit-featured-tag">★ Top Empfehlung</div>
                  <button className="cookit-featured-card" onClick={() => selectRecipe(featured)}>
                    <div className="cookit-featured-title">{featured.title}</div>
                    <div className="cookit-featured-desc">{featured.description}</div>
                    <div className="cookit-featured-meta">
                      <span><Clock /> {featured.time}</span>
                      <span><DifficultyBars level={featured.difficulty} /> {featured.difficulty}</span>
                    </div>
                  </button>
                </div>
              )}

              {others.length > 0 && (
                <div>
                  <div className="cookit-list-label">Weitere Optionen</div>
                  {others.map((r) => (
                    <button key={r.id} className="cookit-card" onClick={() => selectRecipe(r)}>
                      <div className="cookit-card-title">{r.title}</div>
                      <div className="cookit-card-desc">{r.description}</div>
                      <div className="cookit-card-meta">
                        <span><Clock /> {r.time}</span>
                        <span><DifficultyBars level={r.difficulty} /> {r.difficulty}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {screen === "loading-detail" && (
          <div className="cookit-loading">
            <div className="cookit-dots">
              <div className="cookit-dot" />
              <div className="cookit-dot" />
              <div className="cookit-dot" />
            </div>
            <div className="cookit-loading-text">Erstelle Schritt-für-Schritt Anleitung...</div>
          </div>
        )}

        {screen === "detail" && detail && (
          <div className="cookit-page">
            <div className="cookit-page-top">
              <div className="cookit-topbar">
                <button className="cookit-back" onClick={() => setScreen("options")}>
                  <ChevronLeft /> Rezepte
                </button>
              </div>
              <h1 className="cookit-h1">{detail.title}</h1>
              <p className="cookit-sub">{detail.time} • {detail.difficulty} • {servings} Portion(en)</p>
              <div className="cookit-progress">
                <div className="cookit-progress-bar" style={{ width: `${progressPct}%` }} />
              </div>
            </div>

            <div className="cookit-page-scroll" style={{ paddingTop: 14 }}>
              <div className="cookit-ing-box">
                <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 15 }}>Zutaten</div>
                <div className="cookit-ing-grid">
                  {detail.ingredients.map((ing, i) => (
                    <div key={i} className="cookit-ing-item">
                      <span className="cookit-ing-name">{ing.name}</span>
                      <span className="cookit-ing-amount">{ing.amount}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 15 }}>Zubereitung</div>
              {detail.steps.map((step, idx) => {
                const isDone = !!doneSteps[idx];
                return (
                  <div key={idx} className={`cookit-step${isDone ? " done" : ""}`} onClick={() => toggleStep(idx)}>
                    <div className="cookit-step-check">{isDone && <Check />}</div>
                    <div>
                      <div className="cookit-step-title">{idx + 1}. {step.title}</div>
                      <p className="cookit-step-text">{step.content}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="cookit-page-footer">
              <button className="cookit-ghost-btn" onClick={resetAll}>Neues Gericht kochen</button>
            </div>
          </div>
        )}

        {screen === "error" && (
          <div className="cookit-page">
            <div className="cookit-loading">
              <AlertCircle style={{ width: 40, height: 40, color: "var(--orange)" }} />
              <div className="cookit-h1" style={{ fontSize: 20 }}>Fehler aufgetreten</div>
              <p className="cookit-sub">Beim Laden der Daten gab es ein Problem. Bitte versuche es erneut.</p>
              <button className="cookit-ghost-btn" onClick={() => setScreen(errorFrom)} style={{ marginTop: 10 }}>
                Zurück
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// React App im Root-Element rendern
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<CookIt />);
