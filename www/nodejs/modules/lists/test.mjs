import EPGManager from './epg-worker.js';
import storage from '../storage/storage.js';

global.EPGManager = EPGManager;
global.EPG = EPGManager.EPG;
global.storage = storage

async function runTests() {
    console.log("Iniciando testes...");

    // Teste 1: Criar uma instância de EPG
    const url = "http://app.megacubo.net/stats/data/epg.br.xml.gz";

    /*
    const epg = new EPG(url);
    console.assert(epg.url === url, "Teste 1 falhou: URL não corresponde");
    console.assert(epg.state === 'uninitialized', "Teste 1 falhou: Estado inicial não é 'uninitialized'");

    // Teste 2: Iniciar EPG
    await epg.start().then(() => {
        console.assert(epg.loaded === true, "Teste 2 falhou: EPG não está carregado após start");
    }).catch(e => console.error("Teste 2 falhou:", e));
    */

    // Teste 3: Criar uma instância de EPGManager
    const epgManager = global.epgManager = new EPGManager();
    console.assert(epgManager.epgs instanceof Object, "Teste 3 falhou: epgs não é um objeto");

    // Teste 4: Adicionar um EPG ao EPGManager
    epgManager.add(url);
    console.assert(epgManager.epgs[url] instanceof EPG, "Teste 4 falhou: EPG não foi adicionado ao EPGManager");

    // Teste 5: Remover um EPG
    epgManager.remove(url);
    console.assert(epgManager.epgs[url] === undefined, "Teste 5 falhou: EPG não foi removido do EPGManager");

    // Teste 6: Verificar o estado do EPGManager
    epgManager.add(url);
    epgManager.ready().then(() => {
        console.assert(epgManager.epgs[url].loaded === true, "Teste 6 falhou: EPG não está carregado");
    }).catch(e => console.error("Teste 6 falhou:", e));
/*
    // Teste 7: Verificar o estado do EPG
    epgManager.getState().then(state => {
        console.assert(state.state === 'loading' || state.state === 'loaded', "Teste 7 falhou: Estado do EPG é inválido");
    }).catch(e => console.error("Teste 7 falhou:", e));

    // Teste 8: Testar a função destroy
    epgManager.destroy();
    console.assert(epgManager.state === 'uninitialized', "Teste 8 falhou: EPG não foi destruído corretamente");
*/
    console.log("Testes concluídos!");
}

runTests();
setInterval(() => console.log('Script ainda está rodando...'), 10000)
