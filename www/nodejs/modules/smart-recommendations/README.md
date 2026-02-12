# Smart Recommendations Module

Sistema de recomendações inteligente usando análise semântica com Trias para fornecer sugestões personalizadas de conteúdo.

## 🚀 Características

- **Análise Semântica**: Usa Trias para compreender o significado real do conteúdo
- **Expansão Inteligente de Tags**: Expande tags do usuário baseado em similaridade semântica
- **Descoberta de Conteúdo**: Encontra conteúdo similar usando análise semântica
- **Aprendizado Contínuo**: Sistema aprende com feedback do usuário
- **Cache Inteligente**: Cache LRU com prioridade e TTL para performance otimizada
- **Diversidade**: Garante diversidade nas recomendações

## 📁 Estrutura do Módulo

```
smart-recommendations/
├── index.js                      # Ponto de entrada principal
├── EnhancedRecommendations.js    # Sistema principal de recomendações
├── TriasRecommendationEngine.js  # Engine de pontuação semântica
├── SmartTagExpansion.js          # Expansão inteligente de tags
├── SemanticContentDiscovery.js   # Descoberta de conteúdo semântico
├── TriasLearningSystem.js        # Sistema de aprendizado contínuo
├── SmartCache.js                 # Sistema de cache inteligente
└── README.md                     # Documentação
```

## 🔧 Componentes

### 1. EnhancedRecommendations
Sistema principal que orquestra todos os componentes para gerar recomendações inteligentes.

**Características:**
- Combina análise semântica com scoring tradicional
- Aplica filtros de diversidade e qualidade
- Sistema de cache inteligente
- Métricas de performance

### 2. TriasRecommendationEngine
Engine de pontuação que usa Trias para análise semântica.

**Características:**
- Cálculo de similaridade semântica
- Cache de resultados semânticos
- Fallback para scoring tradicional
- Métricas de performance

### 3. SmartTagExpansion
Expande tags do usuário usando análise semântica do Trias.

**Características:**
- Expansão baseada em similaridade semântica
- Boost de diversidade para evitar concentração
- Categorização semântica de tags
- Cache inteligente

### 4. SemanticContentDiscovery
Descobre conteúdo similar usando análise semântica.

**Características:**
- Descoberta baseada em similaridade semântica
- Cálculo de confiança
- Cache de descobertas
- Fallback para similaridade textual

### 5. TriasLearningSystem
Sistema de aprendizado contínuo baseado em feedback do usuário.

**Características:**
- Registro de feedback do usuário
- Atualização de perfis personalizados
- Retreinamento do modelo Trias
- Padrões temporais de comportamento

### 6. SmartCache
Sistema de cache inteligente com LRU, prioridade e TTL.

**Características:**
- Cache LRU com prioridade
- Invalidação por tags
- Limpeza automática de entradas expiradas
- Métricas de performance

## 🚀 Uso

### Inicialização

```javascript
import smartRecommendations from './smart-recommendations/index.js'

// Inicializar com instância do Trias
await smartRecommendations.initialize(triasInstance, {
    semanticWeight: 0.6,
    traditionalWeight: 0.4,
    maxRecommendations: 50,
    cacheSize: 2000
})
```

### Obter Recomendações

```javascript
const userContext = {
    userId: 'user123',
    tags: {
        'action': 0.8,
        'comedy': 0.6,
        'drama': 0.4
    },
    applyParentalControl: true
}

const recommendations = await smartRecommendations.getRecommendations(userContext, {
    limit: 25,
    diversityTarget: 0.7
})
```

### Registrar Feedback

```javascript
await smartRecommendations.recordUserFeedback(
    'user123',
    recommendation,
    'watch', // 'click', 'watch', 'skip', 'dismiss'
    context
)
```

### Expandir Tags

```javascript
const expandedTags = await smartRecommendations.expandUserTags(userTags, {
    maxExpansions: 20,
    similarityThreshold: 0.6,
    diversityBoost: true
})
```

### Descobrir Conteúdo Similar

```javascript
const similarContent = await smartRecommendations.discoverSimilarContent(
    targetProgramme,
    availableProgrammes,
    {
        maxResults: 10,
        similarityThreshold: 0.6
    }
)
```

## 📊 Monitoramento

### Métricas de Performance

```javascript
const metrics = smartRecommendations.getPerformanceMetrics()
console.log('Performance:', metrics)
```

### Status de Saúde

```javascript
const health = smartRecommendations.getHealthStatus()
console.log('Health:', health)
```

### Configuração

```javascript
// Atualizar configuração
smartRecommendations.updateConfig({
    semanticWeight: 0.7,
    cacheSize: 3000
})

// Obter configuração atual
const config = smartRecommendations.getConfig()
```

## 🔄 Eventos

O sistema emite vários eventos para monitoramento:

```javascript
smartRecommendations.on('initialized', () => {
    console.log('Sistema inicializado')
})

smartRecommendations.on('feedbackRecorded', (data) => {
    console.log('Feedback registrado:', data)
})

smartRecommendations.on('modelUpdated', (data) => {
    console.log('Modelo atualizado:', data)
})

smartRecommendations.on('cacheUpdated', (data) => {
    console.log('Cache atualizado:', data)
})
```

## 🛠️ Configuração Avançada

### Pesos Personalizados

O sistema permite ajustar os pesos de diferentes fatores:

```javascript
const weights = {
    semanticRelevance: 0.6,  // Relevância semântica
    temporalRelevance: 0.2,  // Relevância temporal
    userPreference: 0.2      // Preferências do usuário
}
```

### Cache Inteligente

```javascript
const cacheConfig = {
    maxSize: 2000,           // Tamanho máximo do cache
    defaultTTL: 300000,      // TTL padrão (5 minutos)
    cleanupInterval: 60000    // Intervalo de limpeza (1 minuto)
}
```

### Sistema de Aprendizado

```javascript
const learningConfig = {
    learningRate: 0.1,       // Taxa de aprendizado
    maxHistorySize: 10000,    // Tamanho máximo do histórico
    retrainInterval: 3600000  // Intervalo de retreinamento (1 hora)
}
```

## 🔧 Integração

### Com Sistema EPG Existente

```javascript
// Integrar com sistema EPG existente
const epgData = await global.lists.epg.getRecommendations(tags, until, amount)
const enhancedData = await smartRecommendations.enhanceEPGData(epgData, userContext)
```

### Com Sistema de Cache Existente

```javascript
// Integrar com cache existente
const cacheKey = `smart_rec:${userId}:${JSON.stringify(tags)}`
let recommendations = await existingCache.get(cacheKey)

if (!recommendations) {
    recommendations = await smartRecommendations.getRecommendations(userContext)
    await existingCache.set(cacheKey, recommendations, { ttl: 300000 })
}
```

## 📈 Benefícios

1. **Precisão Superior**: Análise semântica real do conteúdo
2. **Descoberta Inteligente**: Encontra conteúdo relacionado automaticamente
3. **Aprendizado Contínuo**: Sistema que melhora com o uso
4. **Performance Otimizada**: Cache inteligente e processamento paralelo
5. **Experiência Personalizada**: Recomendações verdadeiramente personalizadas
6. **Diversidade**: Garante variedade nas recomendações

## 🚨 Tratamento de Erros

O sistema inclui tratamento robusto de erros:

- **Fallback Inteligente**: Quando Trias falha, usa scoring tradicional
- **Cache de Segurança**: Mantém recomendações em cache para casos de falha
- **Logging Detalhado**: Registra erros para debugging
- **Recuperação Automática**: Tenta recuperar de falhas automaticamente

## 🔍 Debugging

### Logs Detalhados

```javascript
// Habilitar logs detalhados
smartRecommendations.updateConfig({
    debug: true,
    verbose: true
})
```

### Métricas de Debug

```javascript
const debugMetrics = {
    expansionTime: smartRecommendations.getPerformanceMetrics().expansionTime,
    cacheHitRate: smartRecommendations.getPerformanceMetrics().cache.hitRate
}
```

## 🎯 Próximos Passos

1. **Integração Gradual**: Implementar gradualmente no sistema existente
2. **Testes A/B**: Comparar com sistema atual
3. **Métricas**: Monitorar performance e precisão
4. **Feedback Loop**: Coletar feedback dos usuários
5. **Otimização Contínua**: Refinar algoritmos baseado em dados reais

