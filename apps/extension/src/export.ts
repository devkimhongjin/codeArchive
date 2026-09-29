import { DEFAULT_DOWNLOAD_FILENAME_TEMPLATE, type Capture } from "./types";
import { describeLanguage } from "../../../shared/language";
import { codeWithHeader, DEFAULT_HEADER_FIELDS, type HeaderField } from "../../../shared/headerFields";
export function sourceFileExtension(language: string): string {
  return describeLanguage(language).extension;
}
export type ExportProfile={name?:string;nickname?:string;id?:string};
export { DEFAULT_DOWNLOAD_FILENAME_TEMPLATE };
export function downloadFilename(capture: Capture, template = DEFAULT_DOWNLOAD_FILENAME_TEMPLATE, profile:ExportProfile={}): string {
 const values: Record<string,string> = {platform:capture.platform, number:capture.problemNumber, title:capture.title, language:capture.language,name:profile.name?.trim()??"",nickname:profile.nickname?.trim()??"",id:profile.id??"",time:formatTime(capture.solvedAt??capture.observedAt),capture_ID:capture.captureId}; const ext=sourceFileExtension(capture.language);
 let name=(template.trim()||DEFAULT_DOWNLOAD_FILENAME_TEMPLATE).replace(/\{([^{}]+)\}/g,(_,k:string)=>values[k]??"").replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g,"-").replace(/[. ]+$/g,"").replace(/^\.+/,"").trim();
 name=name.replace(/\.(java|kt|py|js|ts|c|cpp|cs|go|rs|rb|swift|scala|sql|txt)$/i,""); name=name.slice(0,120).replace(/[. ]+$/g,"")||"solution";
 if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name="_"+name; return `${name}.${ext}`;
}
export function exportCode(capture: Capture, header: boolean, fields: readonly HeaderField[] = DEFAULT_HEADER_FIELDS): string {
  return codeWithHeader(capture, header, fields);
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown-time";
  const iso = date.toISOString();
  return `${iso.slice(2, 10).replace(/-/g, "")}${iso.slice(11, 19).replace(/:/g, "")}`;
}
