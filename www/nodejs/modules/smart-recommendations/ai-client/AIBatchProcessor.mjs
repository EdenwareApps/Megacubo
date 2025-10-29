/**
 * AI Batch Processor
 * Batches multiple requests into single API calls for efficiency
 */

import { EPGErrorHandler } from '../../epg-worker/EPGErrorHandler.js';

export class AIBatchProcessor {
    constructor(aiClient, options = {}) {
        this.aiClient = aiClient;
        this.batchSize = options.batchSize || 50;
        this.batchDelay = options.batchDelay || 100; // ms
        
        this.queues = {
            expand: [],
            cluster: []
        };
        
        this.timers = {
            expand: null,
            cluster: null
        };
    }

    /**
     * Add item to batch queue
     */
    async addToBatch(operation, data, options = {}) {
        return new Promise((resolve, reject) => {
            const queue = this.queues[operation];
            if (!queue) {
                return reject(new Error(`Unknown operation: ${operation}`));
            }

            // Add to queue
            queue.push({ data, options, resolve, reject });

            // Schedule batch processing if needed
            if (queue.length >= this.batchSize) {
                // Process immediately if batch is full
                this.processBatch(operation);
            } else if (!this.timers[operation]) {
                // Schedule delayed processing
                this.timers[operation] = setTimeout(() => {
                    this.processBatch(operation);
                }, this.batchDelay);
            }
        });
    }

    /**
     * Process batch for operation
     */
    async processBatch(operation) {
        const queue = this.queues[operation];
        if (queue.length === 0) return;

        // Clear timer
        if (this.timers[operation]) {
            clearTimeout(this.timers[operation]);
            this.timers[operation] = null;
        }

        // Take items from queue
        const batch = queue.splice(0, this.batchSize);
        
        try {
            let results;
            
            switch (operation) {
                case 'expand':
                    results = await this.processBatchExpand(batch);
                    break;
                case 'cluster':
                    results = await this.processBatchCluster(batch);
                    break;
                default:
                    throw new Error(`Unknown operation: ${operation}`);
            }

            // Resolve promises
            batch.forEach((item, i) => {
                item.resolve(results[i]);
            });

        } catch (error) {
            EPGErrorHandler.error(`Batch processing failed for ${operation}:`, error);
            
            // Reject all promises
            batch.forEach(item => {
                item.reject(error);
            });
        }
    }

    // processBatchAnalyze() removed - not needed

    /**
     * Process batch of expand requests
     */
    async processBatchExpand(batch) {
        // For expand, we can't truly batch (each user has different tags)
        // But we can process them in parallel
        return Promise.all(
            batch.map(item => 
                this.aiClient.request('/api/recommendations/expand-tags', {
                    tags: item.data,
                    locale: item.options.locale || 'pt',
                    limit: item.options.limit || 20,
                    threshold: item.options.threshold || 0.6
                })
            )
        );
    }

    /**
     * Process batch of cluster requests
     */
    async processBatchCluster(batch) {
        return Promise.all(
            batch.map(item =>
                this.aiClient.request('/api/recommendations/cluster-tags', {
                    tags: item.data,
                    locale: item.options.locale || 'pt',
                    clusters: item.options.clusters || 20
                })
            )
        );
    }

    /**
     * Flush all queues
     */
    async flush() {
        const operations = Object.keys(this.queues);
        await Promise.all(
            operations.map(op => this.processBatch(op))
        );
    }
}

