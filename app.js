import { useState, useRef } from "react";
import { ChevronLeft, ChevronRight, X, Plus, Clock, Check, AlertCircle, AlertTriangle, Camera, Mic, Loader2, UtensilsCrossed, Minus, Star, Leaf, Sprout, Fish } from "lucide-react";

const MODEL = "claude-sonnet-4-6";
const SUGGESTIONS = ["Ei", "Nudeln", "Reis", "Kartoffeln", "Zwiebel", "Knoblauch", "Tomaten", "Paprika", "Karotten", "Champignons", "Käse", "Milch", "Hähnchen", "Hackfleisch", "Speck", "Butter"];
const MEAT_ITEMS = ["Hähnchen", "Hackfleisch", "Speck"];
const ANIMAL_ITEMS = ["Ei", "Käse", "Milch", "Butter"];
const DIFF_LEVEL = { Einfach: 1, Mittel: 2, Anspruchsvoll: 3 };
const SEARCH_TOOLS = [{ type: "web_search_20250305", name: "web_search" }];
const DIET_OPTIONS = [
  { value: "vegetarisch", label: "Vegetarisch", Icon: Leaf },
  { value: "vegan", label: "Vegan", Icon: Sprout },
  { value: "pescetarisch", label: "Pescetarisch", Icon: Fish },
];
const DIET_LABELS = { vegetarisch: "Vegetarisch", vegan: "Vegan", pescetarisch: "Pescetarisch" };
const DIET_INSTRUCTIONS = {
  vegetarisch: "Der Nutzer ernährt sich vegetarisch: keine Rezepte mit Fleisch oder Fisch. Eier und Milchprodukte sind erlaubt.",
  vegan: "Der Nutzer ernährt sich vegan: keine Rezepte mit Fleisch, Fisch, Eiern, Milchprodukten oder Honig.",
  pescetarisch: "Der Nutzer ernährt sich pescetarisch: kein Fleisch von Landtieren, aber Fisch und Meeresfrüchte sind erlaubt.",
};

function isSuggestionAllowed(item, diet) {
  if (diet === "vegan") return !MEAT_ITEMS.includes(item) && !ANIMAL_ITEMS.includes(item);
  if (diet === "vegetarisch" || diet === "pescetarisch") return !MEAT_ITEMS.includes(item);
  return true;
}

async function askClaudeText(prompt, withSearch = false) {
  const body = { model: MODEL, max_tokens: 1000, messages: [{ role: "user", content: prompt }] };
  if (withSearch) body.tools = SEARCH_TOOLS;
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error("network");
  const data = await response.json();
  return (data.content || []).map((b) => (b.type === "text" ? b.text : "")).join("\n").trim();
}

function extractJson(text) {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const match = cleaned.match(/[\[{][\s\S]*[\]}]/);
  return JSON.parse(match ? match[0] : cleaned);
}

async function askClaudeJson(prompt) {
  const text = await askClaudeText(prompt, false);
  return extractJson(text);
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
  const text = (data.content || []).map((b) => (b.type === "text" ? b.text : "")).join("\n");
  return extractJson(text);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

// Trennt eine Freitext-Eingabe in einzelne Zutaten auf: Kommas, Semikolons, Zeilenumbrüche,
// "und" sowie ein oder mehrere Leerzeichen zählen alle als Trenner. Reine Zahlen (Mengenangaben) werden verworfen.
function splitIngredientText(raw) {
  return raw
    .split(/[\s,;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter((s) => s.toLowerCase() !== "und")
    .filter((s) => !/^\d+([.,]\d+)?$/.test(s));
}

function formatRating(rating) {
  if (rating == null || Number.isNaN(Number(rating))) return null;
  return String(Number(rating).toFixed(1)).replace(".", ",") + "/5";
}

function ratingText(item) {
  const parts = [];
  if (item?.rating != null) {
    parts.push(formatRating(item.rating) + (item.ratingCount ? ` (${item.ratingCount})` : ""));
  } else {
    parts.push("Keine Bewertung");
  }
  if (item?.source) parts.push(item.source);
  return parts.join(" · ");
}

function sortByRating(list) {
  return [...list].sort((a, b) => {
    const ar = a.rating ?? -1, br = b.rating ?? -1;
    if (br !== ar) return br - ar;
    const ac = a.ratingCount ?? 0, bc = b.ratingCount ?? 0;
    return bc - ac;
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
  const [servings, setServings] = useState(2);
  const [diet, setDiet] = useState(null);
  const [recipes, setRecipes] = useState([]);
  const [unsafeItems, setUnsafeItems] = useState([]);
  const [detail, setDetail] = useState(null);
  const [selectedMeta, setSelectedMeta] = useState(null);
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
    const raw = inputValue.trim();
    if (!raw) return;
    const parts = splitIngredientText(raw);
    if (parts.length) commitIngredients(parts);
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

  function toggleDiet(value) {
    setDiet((d) => (d === value ? null : value));
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

  async function startVoiceInput() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setVoiceState("unsupported");
      return;
    }
    setVoiceState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch (err) {
      setVoiceState("error");
      return;
    }
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
        const parts = splitIngredientText(transcript);
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

  function micLabel() {
    if (voiceState === "requesting") return "Warte auf Zugriff …";
    if (voiceState === "listening") return "Ich höre …";
    return "Diktieren";
  }

  async function findRecipes() {
    setScreen("loading-recipes");
    try {
      const dietLine = diet ? DIET_INSTRUCTIONS[diet] : "";
      const searchPrompt = `Du bist ein erfahrener Koch-Assistent. Ein Nutzer hat folgende Angaben gemacht: ${ingredients.join(", ")}.

Schritt 1: Prüfe, ob alle Angaben echte, zum Verzehr geeignete Lebensmittel-Zutaten sind. Liste alle Angaben, die KEINE essbaren Lebensmittel sind (z.B. Chemikalien, Gifte, Haushaltsgegenstände, Non-Food-Artikel), separat unter "NICHT ESSBAR:" mit je einer kurzen Begründung auf. Falls alle Angaben essbar sind, schreibe "NICHT ESSBAR: keine".

Schritt 2: Nutze die essbaren Zutaten als Ausgangspunkt, plus übliche Grundzutaten (Salz, Pfeffer, Öl, Wasser, Zucker, Mehl). Du musst NICHT jede einzelne genannte Zutat in jedem Rezept verwenden — wähle die Rezepte danach aus, was insgesamt am besten schmeckt, am besten zusammenpasst und am besten bewertet ist, auch wenn dabei mal eine Zutat übrig bleibt. ${dietLine} Die Gerichte sollen für ${servings} Person(en) geeignet sein.

Führe eine gezielte Websuche nach Rezepten durch, bevorzugt auf bekannten Rezeptportalen (z.B. Chefkoch, EatSmarter, Lecker, essen-und-trinken, Kitchen Stories, Allrecipes). Bevorzuge dabei Rezepte mit möglichst guten UND möglichst vielen Bewertungen — populäre, gut bewertete Rezepte vor kaum bewerteten. Wähle 4 möglichst unterschiedliche Gerichte aus verschiedenen Kategorien/Küchenstilen aus (nicht wiederholt "schnelle Pfanne" oder "Ofengemüse", außer eines davon passt wirklich am besten).

Liste unter "REZEPTE:" für jedes der 4 Gerichte kurz und knapp (max. 3 Zeilen): Titel, Quell-Plattform, Bewertung dort falls vorhanden inkl. Anzahl der Bewertungen (z.B. "4,3 von 5 bei 210 Bewertungen"), sonst "keine Bewertung", ungefähre Zubereitungszeit, Schwierigkeitsgrad (Einfach/Mittel/Anspruchsvoll), 1-Satz-Beschreibung.`;

      const notes = await askClaudeText(searchPrompt, true);

      const formatPrompt = `Wandle die folgenden Rezept-Recherche-Notizen in valides JSON um. Antworte NUR mit dem JSON, ohne Markdown, ohne Codeblock, ohne Erklärung, in exakt diesem Format:
{"unsafe":[{"name":"...","reason":"kurzer Grund"}],"recipes":[{"id":"1","title":"...","description":"kurze Beschreibung, max. 10 Wörter","time":"z.B. 20 Min.","difficulty":"Einfach|Mittel|Anspruchsvoll","source":"Plattform-Name oder null","rating":Zahl_zwischen_0_und_5_oder_null,"ratingCount":Zahl_oder_null}]}
"unsafe" ist ein leeres Array [], falls keine unsicheren Zutaten genannt wurden.

Notizen:
${notes}`;

      const result = await askClaudeJson(formatPrompt);
      const recipeList = Array.isArray(result?.recipes) ? result.recipes : [];
      if (recipeList.length === 0) throw new Error("empty");
      setRecipes(sortByRating(recipeList));
      setUnsafeItems(Array.isArray(result?.unsafe) ? result.unsafe : []);
      setScreen("options");
    } catch (e) {
      setErrorFrom("input");
      setScreen("error");
    }
  }

  async function selectRecipe(recipe) {
    setSelectedMeta({ source: recipe.source || null, rating: recipe.rating ?? null, ratingCount: recipe.ratingCount ?? null });
    setScreen("loading-detail");
    try {
      const dietLine = diet ? DIET_INSTRUCTIONS[diet] : "";
      const searchPrompt = `Recherchiere per Websuche ein echtes, passendes Rezept für "${recipe.title}" (${recipe.description})${recipe.source ? `, idealerweise von ${recipe.source} oder einer vergleichbaren Quelle` : ""}. Verfügbare Zutaten des Nutzers: ${ingredients.join(", ")}. Grundzutaten wie Salz, Pfeffer, Öl, Wasser, Zucker, Mehl darfst du zusätzlich voraussetzen. ${dietLine}

Die Zubereitung ist für genau ${servings} Person(en) ausgelegt. Skaliere ALLE Zutatenmengen exakt und proportional auf ${servings} Person(en), mit konkreten Einheiten (g, ml, Stück, EL, TL). Vermeide vage Angaben wie "etwas" oder "nach Bedarf" — nur bei reinen Würzzutaten zum Abschmecken (Salz, Pfeffer) ist "nach Geschmack" akzeptabel.

Notiere kurz und knapp: die vollständige Zutatenliste mit genauen Mengen, sowie 4 bis 7 nummerierte Zubereitungsschritte mit je einem kurzen Titel und einer knappen Anweisung.`;

      const notes = await askClaudeText(searchPrompt, true);

      const formatPrompt = `Wandle die folgenden Rezept-Notizen in valides JSON um. Antworte NUR mit dem JSON, ohne Markdown, ohne Codeblock, ohne Erklärung, in exakt diesem Format:
{"title":"${recipe.title}","time":"${recipe.time}","difficulty":"${recipe.difficulty}","ingredients":[{"name":"Zutat","amount":"genaue Menge mit Einheit"}],"steps":[{"title":"kurzer Schritt-Titel","content":"konkrete, knappe Anweisung, 1-2 Sätze"}]}

Notizen:
${notes}`;

      const result = await askClaudeJson(formatPrompt);
      if (!result || !Array.isArray(result.steps) || result.steps.length === 0) throw new Error("empty");
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
    setUnsafeItems([]);
    setDetail(null);
    setSelectedMeta(null);
    setDoneSteps({});
    setPhotoState("idle");
    setVoiceState("idle");
    setScreen("input");
  }

  const availableSuggestions = SUGGESTIONS.filter(
    (s) => !ingredients.some((i) => i.toLowerCase() === s.toLowerCase()) && isSuggestionAllowed(s, diet)
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
          --red: #C42B1C;
          --red-bg: #FEECEC;
          --red-border: #F5B5B0;
          --font: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Inter", "Helvetica Neue", Arial, sans-serif;

          font-family: var(--font);
          background: var(--bg-subtle);
          min-height: 100vh;
          min-height: 100dvh;
          display: flex;
          justify-content: center;
          box-sizing: border-box;
          color: var(--black);
          -webkit-font-smoothing: antialiased;
        }
        .cookit-app *, .cookit-app *::before, .cookit-app *::after { box-sizing: border-box; }
        .cookit-shell { width: 100%; max-width: 460px; background: var(--bg); min-height: 100vh; min-height: 100dvh; display: flex; flex-direction: column; }

        .cookit-page { flex: 1; display: flex; flex-direction: column; animation: cookit-fade 0.28s ease both; }
        @keyframes cookit-fade { from { opacity: 0; } to { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { .cookit-page, .cookit-chip { animation: none !important; } }

        .cookit-page-top { padding: 18px 22px 0; }
        .cookit-page-scroll { flex: 1; padding: 0 22px 14px; }
        .cookit-page-footer { position: sticky; bottom: 0; background: var(--bg); padding: 12px 22px calc(18px + env(safe-area-inset-bottom, 0px)); box-shadow: 0 -10px 18px -12px rgba(0,0,0,0.12); }

        .cookit-topbar { display: flex; align-items: center; min-height: 28px; margin-bottom: 6px; }
        .cookit-back { display: flex; align-items: center; gap: 2px; background: none; border: none; color: var(--orange); font-size: 16px; font-weight: 600; font-family: var(--font); cursor: pointer; padding: 6px 4px 6px 0; margin-left: -4px; }
        .cookit-back:active { opacity: 0.5; }

        .cookit-brand { display: flex; align-items: center; gap: 8px; }
        .cookit-brand-icon { width: 26px; height: 26px; border-radius: 8px; background: var(--orange); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .cookit-brand-name { font-size: 16px; font-weight: 700; letter-spacing: -0.01em; }

        .cookit-h1 { font-size: 24px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.15; margin: 6px 0 4px; }
        .cookit-sub { font-size: 14px; color: var(--text-secondary); line-height: 1.4; margin: 0; }

        .cookit-servings-row { display: flex; align-items: center; justify-content: space-between; margin: 12px 0 10px; padding: 10px 14px; background: var(--bg-subtle); border-radius: 14px; }
        .cookit-servings-label { font-size: 14px; font-weight: 600; }
        .cookit-stepper { display: flex; align-items: center; gap: 12px; }
        .cookit-stepper-btn { width: 25px; height: 25px; flex: 0 0 25px; border-radius: 50%; border: 1.5px solid var(--border); background: var(--bg); display: flex; align-items: center; justify-content: center; cursor: pointer; }
        .cookit-stepper-btn:active { transform: scale(0.9); }
        .cookit-stepper-btn:disabled { opacity: 0.3; cursor: not-allowed; }
        .cookit-stepper-count { min-width: 18px; text-align: center; font-size: 14.5px; font-weight: 700; }

        .cookit-diet-row { margin: 0 0 10px; }
        .cookit-diet-options { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; padding-bottom: 2px; }
        .cookit-diet-options::-webkit-scrollbar { display: none; }
        .cookit-diet-chip { flex-shrink: 0; display: inline-flex; align-items: center; gap: 5px; border: 1.5px solid var(--border); background: var(--bg); border-radius: 100px; padding: 7px 13px; font-size: 12.5px; font-weight: 600; color: var(--black); cursor: pointer; white-space: nowrap; transition: all 0.15s ease; }
        .cookit-diet-chip.selected { background: var(--orange); border-color: var(--orange); color: white; }

        .cookit-input-row { display: flex; gap: 8px; margin-top: 4px; }
        .cookit-input { flex: 1; border: 1.5px solid var(--border); background: var(--bg-subtle); border-radius: 14px; padding: 13px 16px; font-size: 16px; font-family: var(--font); color: var(--black); outline: none; transition: border-color 0.15s ease, background 0.15s ease; }
        .cookit-input:focus { border-color: var(--orange); background: var(--bg); }
        .cookit-input::placeholder { color: #A9A9AE; }
        .cookit-add-btn { width: 46px; height: 46px; border-radius: 14px; background: var(--black); border: none; display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; transition: transform 0.1s ease, opacity 0.15s ease; }
        .cookit-add-btn:active { transform: scale(0.92); }
        .cookit-add-btn:disabled { opacity: 0.4; cursor: not-allowed; }

        .cookit-action-row { display: flex; gap: 10px; margin-top: 10px; }
        .cookit-action-btn { flex: 1; display: flex; align-items: center; justify-content: center; gap: 7px; border: 1.5px solid var(--border); background: var(--bg); border-radius: 14px; padding: 11px; font-size: 13px; font-weight: 600; color: var(--black); cursor: pointer; font-family: var(--font); transition: border-color 0.15s ease, transform 0.1s ease, background 0.15s ease; white-space: nowrap; }
        .cookit-action-btn:active { transform: scale(0.97); }
        .cookit-action-btn.listening { border-color: var(--orange); background: var(--orange-tint); color: var(--orange-dark); }
        .cookit-action-btn:disabled { opacity: 0.7; cursor: not-allowed; }
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

        .cookit-section-label { font-size: 19px; font-weight: 700; letter-spacing: -0.01em; margin: 4px 0 14px; }
        .cookit-list-label { font-size: 13.5px; font-weight: 600; color: var(--text-secondary); margin: 22px 0 4px; }

        .cookit-warning { display: flex; gap: 10px; align-items: flex-start; background: var(--red-bg); border: 1.5px solid var(--red-border); border-radius: 14px; padding: 13px 14px; margin: 4px 0 18px; color: var(--red); }
        .cookit-warning-title { font-size: 13px; font-weight: 700; margin: 0 0 3px; color: var(--red); }
        .cookit-warning-text { font-size: 12.5px; line-height: 1.4; margin: 0; color: var(--red); }

        .cookit-featured-tag { font-size: 12.5px; font-weight: 600; color: var(--orange); margin: 6px 0 10px; }
        .cookit-featured-card { text-align: left; width: 100%; border: none; border-radius: 22px; padding: 20px; background: linear-gradient(155deg, #171717, var(--black)); cursor: pointer; transition: transform 0.1s ease; font-family: var(--font); }
        .cookit-featured-card:active { transform: scale(0.98); }
        .cookit-featured-title { font-size: 20px; font-weight: 700; color: white; margin: 0 0 6px; letter-spacing: -0.01em; }
        .cookit-featured-desc { font-size: 14px; color: rgba(255,255,255,0.65); margin: 0 0 16px; line-height: 1.4; }
        .cookit-featured-badges { display: flex; gap: 8px; flex-wrap: wrap; }
        .cookit-featured-badge { display: flex; align-items: center; gap: 5px; background: rgba(255,255,255,0.12); border-radius: 100px; padding: 6px 12px; font-size: 12px; font-weight: 600; color: white; }

        .cookit-list-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; text-align: left; padding: 14px 2px; border: none; border-bottom: 1px solid var(--border); background: none; cursor: pointer; font-family: var(--font); }
        .cookit-list-row:last-child { border-bottom: none; }
        .cookit-list-row:active { opacity: 0.55; }
        .cookit-row-title { font-size: 15.5px; font-weight: 600; margin: 0 0 5px; }
        .cookit-row-meta { display: flex; align-items: center; gap: 9px; font-size: 11.5px; font-weight: 600; color: var(--text-secondary); flex-wrap: wrap; row-gap: 4px; }
        .cookit-row-meta-item { display: flex; align-items: center; gap: 4px; }

        .cookit-diff { display: flex; align-items: flex-end; gap: 3px; }
        .cookit-diff-bar { width: 4px; border-radius: 2px; background: rgba(255,255,255,0.3); flex-shrink: 0; }
        .cookit-diff-bar.filled { background: var(--orange); }
        .cookit-row-meta .cookit-diff-bar { background: var(--border); }
        .cookit-row-meta .cookit-diff-bar.filled { background: var(--orange); }

        .cookit-detail-badges { display: flex; gap: 8px; flex-wrap: wrap; margin: 10px 0 20px; }
        .cookit-badge { display: flex; align-items: center; gap: 6px; background: var(--bg-subtle); border-radius: 100px; padding: 7px 12px; font-size: 12.5px; font-weight: 600; color: var(--black); }

        .cookit-progress-wrap { margin: 0 0 24px; }
        .cookit-progress-track { height: 6px; background: var(--bg-subtle); border-radius: 100px; overflow: hidden; margin-bottom: 8px; }
        .cookit-progress-fill { height: 100%; background: var(--orange); border-radius: 100px; transition: width 0.25s ease; }
        .cookit-progress-text { font-size: 13px; font-weight: 600; color: var(--text-secondary); }

        .cookit-ing-list { display: flex; flex-direction: column; gap: 12px; margin-bottom: 26px; }
        .cookit-ing-row { display: flex; align-items: baseline; gap: 10px; font-size: 15.5px; padding-bottom: 12px; border-bottom: 1px solid var(--border); }
        .cookit-ing-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--orange); flex-shrink: 0; margin-bottom: 2px; }
        .cookit-ing-name { flex: 1; font-weight: 500; }
        .cookit-ing-amount { color: var(--text-secondary); font-weight: 600; white-space: nowrap; padding-left: 10px; }

        .cookit-steps { display: flex; flex-direction: column; gap: 2px; padding-bottom: 6px; }
        .cookit-step { display: flex; align-items: flex-start; gap: 14px; padding: 14px 0; }
        .cookit-step-num {
          flex: 0 0 30px; width: 30px; height: 30px; min-width: 30px; min-height: 30px; max-width: 30px; max-height: 30px;
          aspect-ratio: 1 / 1; border-radius: 50%; background: var(--orange); color: white; font-weight: 700; font-size: 14px;
          display: flex; align-items: center; justify-content: center; align-self: flex-start; margin-top: 1px;
          transition: background 0.15s ease; line-height: 1;
        }
        .cookit-step-num.done { background: var(--black); }
        .cookit-step-body { flex: 1; min-width: 0; cursor: pointer; }
        .cookit-step-title { font-size: 15.5px; font-weight: 700; margin: 0 0 4px; transition: opacity 0.15s ease; }
        .cookit-step-content { font-size: 14.5px; color: var(--text-secondary); line-height: 1.5; margin: 0; transition: opacity 0.15s ease; }
        .cookit-step.done .cookit-step-title, .cookit-step.done .cookit-step-content { opacity: 0.4; }
        .cookit-step-check {
          flex: 0 0 26px; width: 26px; height: 26px; min-width: 26px; min-height: 26px; max-width: 26px; max-height: 26px;
          aspect-ratio: 1 / 1; border-radius: 50%; border: 1.5px solid var(--border); background: var(--bg);
          display: flex; align-items: center; justify-content: center; align-self: flex-start; margin-top: 3px; cursor: pointer;
          transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
        }
        .cookit-step-check.done { background: var(--orange); border-color: var(--orange); transform: scale(1.05); }

        .cookit-error { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 6px; padding: 40px; }
        .cookit-error-title { font-size: 19px; font-weight: 700; margin: 14px 0 0; }
        .cookit-error-text { font-size: 15px; color: var(--text-secondary); margin: 0 0 14px; max-width: 30ch; }
        .cookit-error .cookit-cta { width: auto; padding: 13px 30px; }
      `}</style>

      <div className="cookit-shell">
        {screen === "input" && (
          <div className="cookit-page">
            <div className="cookit-page-top">
              <div className="cookit-topbar">
                <div className="cookit-brand">
                  <div className="cookit-brand-icon"><UtensilsCrossed size={14} color="white" strokeWidth={2.3} /></div>
                  <span className="cookit-brand-name">CookIt</span>
                </div>
              </div>
              <h1 className="cookit-h1">Was hast du zu Hause?</h1>
              <p className="cookit-sub">Zutaten eingeben, fotografieren oder ansagen.</p>
            </div>

            <div className="cookit-page-scroll">
              <div className="cookit-servings-row">
                <span className="cookit-servings-label">Portionen</span>
                <div className="cookit-stepper">
                  <button className="cookit-stepper-btn" onClick={decServings} disabled={servings <= 1}><Minus size={13} strokeWidth={2.6} /></button>
                  <span className="cookit-stepper-count">{servings}</span>
                  <button className="cookit-stepper-btn" onClick={incServings} disabled={servings >= 12}><Plus size={13} strokeWidth={2.6} /></button>
                </div>
              </div>

              <div className="cookit-diet-row">
                <div className="cookit-diet-options">
                  {DIET_OPTIONS.map((opt) => {
                    const Icon = opt.Icon;
                    return (
                      <button
                        key={opt.value}
                        className={`cookit-diet-chip${diet === opt.value ? " selected" : ""}`}
                        onClick={() => toggleDiet(opt.value)}
                      >
                        <Icon size={13} strokeWidth={2.2} />
                        <span>{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
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
                  {photoState === "loading" ? <Loader2 size={16} className="cookit-spin" /> : <Camera size={16} strokeWidth={2.2} />}
                  <span>Fotografieren</span>
                </button>
                <button
                  className={`cookit-action-btn${voiceState === "listening" ? " listening" : ""}`}
                  onClick={startVoiceInput}
                  disabled={voiceState === "requesting" || voiceState === "listening"}
                >
                  {voiceState === "requesting" ? <Loader2 size={16} className="cookit-spin" /> : <Mic size={16} strokeWidth={2.2} />}
                  <span>{micLabel()}</span>
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
              {voiceState === "unsupported" && <p className="cookit-inline-note">Spracheingabe wird in dieser Umgebung nicht unterstützt.</p>}
              {voiceState === "error" && <p className="cookit-inline-note">Mikrofonzugriff war nicht möglich. Bitte Berechtigung prüfen.</p>}

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
            </div>

            <div className="cookit-page-footer">
              <button className="cookit-cta" onClick={findRecipes} disabled={ingredients.length === 0}>
                Rezepte finden
              </button>
            </div>
          </div>
        )}

        {screen === "loading-recipes" && (
          <div className="cookit-loading">
            <div className="cookit-dots"><span className="cookit-dot" /><span className="cookit-dot" /><span className="cookit-dot" /></div>
            <p className="cookit-loading-text">Suche & prüfe Rezepte …</p>
          </div>
        )}

        {screen === "options" && (
          <div className="cookit-page">
            <div className="cookit-page-top">
              <div className="cookit-topbar">
                <button className="cookit-back" onClick={resetAll}><ChevronLeft size={20} strokeWidth={2.5} />Zutaten</button>
              </div>
              <h1 className="cookit-h1" style={{ fontSize: 22 }}>{recipes.length} Ideen für dich</h1>
              <p className="cookit-sub">
                Für {servings} {servings === 1 ? "Person" : "Personen"}{diet ? ` · ${DIET_LABELS[diet]}` : ""}
              </p>
            </div>

            <div className="cookit-page-scroll">
              {unsafeItems.length > 0 && (
                <div className="cookit-warning">
                  <AlertTriangle size={17} strokeWidth={2.2} style={{ flexShrink: 0, marginTop: 1 }} />
                  <div>
                    <p className="cookit-warning-title">Nicht berücksichtigt</p>
                    <p className="cookit-warning-text">
                      {unsafeItems.map((u) => u.name).join(", ")} {unsafeItems.length === 1 ? "ist" : "sind"} nicht zum Verzehr geeignet und potenziell gefährlich — {unsafeItems.length === 1 ? "wurde" : "wurden"} deshalb nicht in die Rezepte übernommen.
                    </p>
                  </div>
                </div>
              )}

              {featured && (
                <>
                  <p className="cookit-featured-tag">Top-Empfehlung</p>
                  <button className="cookit-featured-card" onClick={() => selectRecipe(featured)}>
                    <p className="cookit-featured-title">{featured.title}</p>
                    <p className="cookit-featured-desc">{featured.description}</p>
                    <div className="cookit-featured-badges">
                      <span className="cookit-featured-badge"><Clock size={12} strokeWidth={2.4} />{featured.time}</span>
                      <span className="cookit-featured-badge"><DifficultyBars level={featured.difficulty} />{featured.difficulty}</span>
                      <span className="cookit-featured-badge">
                        {featured.rating != null && <Star size={11} fill="white" color="white" strokeWidth={0} />}
                        {ratingText(featured)}
                      </span>
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
                            <span className="cookit-row-meta-item">
                              {r.rating != null && <Star size={10} fill="var(--orange)" color="var(--orange)" strokeWidth={0} />}
                              {ratingText(r)}
                            </span>
                          </div>
                        </div>
                        <ChevronRight size={18} color="var(--text-secondary)" />
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {screen === "loading-detail" && (
          <div className="cookit-loading">
            <div className="cookit-dots"><span className="cookit-dot" /><span className="cookit-dot" /><span className="cookit-dot" /></div>
            <p className="cookit-loading-text">Anleitung wird vorbereitet …</p>
          </div>
        )}

        {screen === "detail" && detail && (
          <div className="cookit-page">
            <div className="cookit-page-top">
              <div className="cookit-topbar">
                <button className="cookit-back" onClick={() => setScreen("options")}><ChevronLeft size={20} strokeWidth={2.5} />Zurück</button>
              </div>
            </div>

            <div className="cookit-page-scroll">
              <h1 className="cookit-h1" style={{ fontSize: 23 }}>{detail.title}</h1>
              <div className="cookit-detail-badges">
                <span className="cookit-badge"><Clock size={13} strokeWidth={2.4} />{detail.time}</span>
                <span className="cookit-badge"><DifficultyBars level={detail.difficulty} />{detail.difficulty}</span>
                <span className="cookit-badge">{servings} {servings === 1 ? "Portion" : "Portionen"}</span>
                {selectedMeta && (
                  <span className="cookit-badge">
                    {selectedMeta.rating != null && <Star size={12} fill="var(--orange)" color="var(--orange)" strokeWidth={0} />}
                    {ratingText(selectedMeta)}
                  </span>
                )}
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
            </div>

            <div className="cookit-page-footer">
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
