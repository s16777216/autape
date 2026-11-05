import { useState, useEffect, useRef } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import type { CookiesData, LocalStorageData } from "@/types/api";

interface JsonEditorAccordionProps {
  initCookies?: CookiesData | null;
  initLocalStorage?: LocalStorageData | null;
  onChange: (data: {
    cookies: CookiesData | null;
    localStorage: LocalStorageData | null;
    isValid: boolean;
  }) => void;
}

// Helpers for validation
function validateCookies(str: string): { parsed: CookiesData | null; isValid: boolean; error: string | null } {
  const trimmed = str.trim();
  if (trimmed === "") return { parsed: null, isValid: true, error: null };
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {
        parsed: null,
        isValid: false,
        error: "Cookies 必須為 JSON 物件格式 (例如: { \"domain/path\": { \"name\": \"value\" } })",
      };
    }
    return { parsed: parsed as CookiesData, isValid: true, error: null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { parsed: null, isValid: false, error: `JSON 解析失敗: ${msg}` };
  }
}

function validateLocalStorage(str: string): { parsed: LocalStorageData | null; isValid: boolean; error: string | null } {
  const trimmed = str.trim();
  if (trimmed === "") return { parsed: null, isValid: true, error: null };
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {
        parsed: null,
        isValid: false,
        error: "LocalStorage 必須為 JSON 物件格式 (例如: { \"key\": \"value\" })",
      };
    }
    return { parsed: parsed as LocalStorageData, isValid: true, error: null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { parsed: null, isValid: false, error: `JSON 解析失敗: ${msg}` };
  }
}

export function JsonEditorAccordion({
  initCookies,
  initLocalStorage,
  onChange,
}: JsonEditorAccordionProps) {
  const [cookiesStr, setCookiesStr] = useState(
    initCookies ? JSON.stringify(initCookies, null, 2) : ""
  );
  const [localStorageStr, setLocalStorageStr] = useState(
    initLocalStorage ? JSON.stringify(initLocalStorage, null, 2) : ""
  );

  // Compute validation during render phase
  const { parsed: parsedCookies, isValid: isCookiesValid, error: cookiesError } = validateCookies(cookiesStr);
  const { parsed: parsedLocalStorage, isValid: isLocalStorageValid, error: localStorageError } = validateLocalStorage(localStorageStr);
  const isValid = isCookiesValid && isLocalStorageValid;

  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onChangeRef.current({
      cookies: parsedCookies,
      localStorage: parsedLocalStorage,
      isValid,
    });
  }, [cookiesStr, localStorageStr, parsedCookies, parsedLocalStorage, isValid]);

  return (
    <div className="flex flex-col gap-4">
      {/* Cookies JSON Textarea */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1">
            初始 Cookies (JSON 物件)
          </label>
          {cookiesStr.trim() !== "" && (
            cookiesError ? (
              <span className="text-[9px] text-rose-400 flex items-center gap-0.5 font-medium">
                <AlertCircle size={10} /> 格式錯誤
              </span>
            ) : (
              <span className="text-[9px] text-emerald-400 flex items-center gap-0.5 font-medium">
                <CheckCircle2 size={10} /> 格式正確
              </span>
            )
          )}
        </div>
        <Textarea
          value={cookiesStr}
          onChange={(e) => setCookiesStr(e.target.value)}
          placeholder={`{\n  "localhost/": {\n    "token": "jwt-token-here"\n  }\n}`}
          className={`bg-zinc-950/80 border text-zinc-100 font-mono text-xs resize-y min-h-[100px] placeholder:text-zinc-700 ${
            cookiesError ? "border-rose-900/50 focus-visible:ring-rose-500" : "border-zinc-850"
          }`}
        />
        {cookiesError && (
          <span className="text-[10px] text-rose-400 leading-tight mt-0.5">{cookiesError}</span>
        )}
      </div>

      {/* LocalStorage JSON Textarea */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1">
            初始 LocalStorage (JSON 物件)
          </label>
          {localStorageStr.trim() !== "" && (
            localStorageError ? (
              <span className="text-[9px] text-rose-400 flex items-center gap-0.5 font-medium">
                <AlertCircle size={10} /> 格式錯誤
              </span>
            ) : (
              <span className="text-[9px] text-emerald-400 flex items-center gap-0.5 font-medium">
                <CheckCircle2 size={10} /> 格式正確
              </span>
            )
          )}
        </div>
        <Textarea
          value={localStorageStr}
          onChange={(e) => setLocalStorageStr(e.target.value)}
          placeholder={`{\n  "user_theme": "dark",\n  "login_status": "true"\n}`}
          className={`bg-zinc-950/80 border text-zinc-100 font-mono text-xs resize-y min-h-[100px] placeholder:text-zinc-700 ${
            localStorageError ? "border-rose-900/50 focus-visible:ring-rose-500" : "border-zinc-850"
          }`}
        />
        {localStorageError && (
          <span className="text-[10px] text-rose-400 leading-tight mt-0.5">{localStorageError}</span>
        )}
      </div>
    </div>
  );
}
