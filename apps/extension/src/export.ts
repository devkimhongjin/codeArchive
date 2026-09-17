import type { Capture } from "./types";
export function sourceFileExtension(language: string): string {
  const n = language.toLowerCase();
  if (n.includes("python") || n.includes("pypy")) return "py"; if (n.includes("typescript") || n === "ts") return "ts"; if (n.includes("javascript") || n === "js") return "js";
  if (n.includes("kotlin")) return "kt"; if (n.includes("java")) return "java"; if (n.includes("c++") || n.includes("cpp")) return "cpp"; if (/^c(?:\s|\d|$)/.test(n)) return "c";
  if (n === "c#" || n.startsWith("c# ") || n.includes("csharp")) return "cs"; if (n === "go" || n.startsWith("go ")) return "go"; if (n.includes("rust")) return "rs"; if (n.includes("ruby")) return "rb"; if (n.includes("swift")) return "swift"; if (n.includes("scala")) return "scala"; if (n.includes("sql")) return "sql"; return "txt";
}
export type ExportProfile={name?:string;nickname?:string;id?:string};
export function downloadFilename(capture: Capture, template = "{platform}-{number}-{title}", profile:ExportProfile={}): string {
 const values: Record<string,string> = {platform:capture.platform, number:capture.problemNumber, title:capture.title, language:capture.language,name:profile.name?.trim()??"",nickname:profile.nickname?.trim()??"",id:profile.id??""}; const ext=sourceFileExtension(capture.language);
 let name=(template.trim()||"{platform}-{number}-{title}").replace(/\{([^{}]+)\}/g,(_,k:string)=>values[k]??"").replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g,"-").replace(/[. ]+$/g,"").replace(/^\.+/,"").trim();
 name=name.replace(/\.(java|kt|py|js|ts|c|cpp|cs|go|rs|rb|swift|scala|sql|txt)$/i,""); name=name.slice(0,120).replace(/[. ]+$/g,"")||"solution";
 if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name="_"+name; return `${name}.${ext}`;
}
export function exportCode(capture: Capture, header: boolean): string {
  if (!header) return capture.sourceCode;
  const ext = sourceFileExtension(capture.language);
  const prefix = ["py", "rb"].includes(ext) ? "#" : ext === "sql" ? "--" : ext === "txt" ? "" : "//";
  if (!prefix) return capture.sourceCode;
  const clean = (value: string) => {
    const line = value.replace(/[\r\n\u2028\u2029]/g, " ");
    return ext === "java" ? line.replace(/\\/g, "/") : line;
  };
  const lines = [
    `${capture.platform} #${capture.problemNumber} · ${capture.title}`,
    capture.problemUrl,
    `Language: ${capture.language}`
  ];
  if (capture.executionTime !== undefined) lines.push(`Execution Time: ${capture.executionTime} ms`);
  if (capture.memoryValue !== undefined && capture.memoryUnit && capture.memoryUnit !== "UNKNOWN") {
    lines.push(`Memory: ${capture.memoryValue} ${capture.memoryUnit}`);
  } else if (capture.memoryUsage !== undefined) {
    lines.push(`Memory: ${capture.memoryUsage} (unit unknown)`);
  }
  const head = lines.map(line => `${prefix} ${clean(line)}`).join("\n") + "\n\n";
  if (capture.sourceCode.startsWith("#!")) {
    const end = capture.sourceCode.indexOf("\n");
    if (end >= 0) return capture.sourceCode.slice(0, end + 1) + head + capture.sourceCode.slice(end + 1);
  }
  return head + capture.sourceCode;
}
