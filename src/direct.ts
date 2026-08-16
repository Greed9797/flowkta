import { engine } from "./engine.js";

/**
 * Canal direto: útil para conferir o estado do ambiente sem subir servidor nenhum.
 * `npm run direct`
 */
const resultado = await engine.invoke("midia-diagnostico", {}, { principal: null });
console.log(JSON.stringify(resultado, null, 2));
