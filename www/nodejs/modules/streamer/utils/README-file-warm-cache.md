# FileWarmCache - Implementação 100% em Arquivo

## Resumo

Implementação do `warmCache` que armazena **100% dos dados em arquivo** ao invés de memória, prevenindo problemas de OOM (Out of Memory) quando múltiplos streams estão ativos simultaneamente.

## Mudanças

### Arquivos Criados
- `file-warm-cache.js` - Nova classe que gerencia warmCache em arquivo
- `test-file-warm-cache.js` - Testes isolados para validação

### Arquivos Modificados
- `downloader.js` - Atualizado para usar `FileWarmCache` ao invés de `MultiBuffer`

## Benefícios

1. **Economia de Memória**: Cada stream economiza até 48MB de RAM (de ~48MB para ~0MB em memória)
2. **Prevenção de OOM**: Múltiplos streams não acumulam buffers grandes em memória
3. **Latência Aceitável**: Leitura de arquivo assíncrona (~100-300ms) é imperceptível no contexto de buffering

## Como Funciona

1. **Append**: Dados são escritos diretamente em arquivo temporário
2. **Rotação**: Quando o arquivo atinge o tamanho máximo, mantém apenas os últimos 75% (encontra sync byte)
3. **Leitura**: Quando cliente se conecta, lê arquivo assincronamente e envia
4. **Limpeza**: Arquivo é deletado quando stream é destruído

## Testando

### Teste Isolado
```bash
cd www/nodejs/modules/streamer/utils
node test-file-warm-cache.js
```

O teste valida:
- ✅ Append básico
- ✅ Múltiplos appends
- ✅ Rotação automática
- ✅ Leitura assíncrona
- ✅ Destroy e limpeza
- ✅ Uso de memória (verifica que dados não ficam em memória)

### Teste em Produção
1. Iniciar um stream que usa warmCache
2. Verificar que arquivo temporário é criado em `paths.temp`
3. Verificar logs: `SENT WARMCACHE` deve aparecer quando cliente se conecta
4. Monitorar uso de memória - deve ser significativamente menor

## Compatibilidade

- Mantém mesma interface que `MultiBuffer` (append, length, slice, destroy)
- Adiciona método `getSlice()` para leitura assíncrona
- Método `rotate()` agora é interno (chamado automaticamente)

## Notas Técnicas

- Arquivos são criados em `paths.temp` com nome único
- Rotação usa `findSyncBytePosition` para manter alinhamento MPEGTS
- Bitrate sampling ainda funciona (salva arquivo temporário)
- Committed flag é atualizada via eventos `commit`/`uncommit`





