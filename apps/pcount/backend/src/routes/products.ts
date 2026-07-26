import { Router } from 'express';
import * as store from '../store.js';
import { broadcast, getScannerCountWs } from '../ws.js';

const router = Router();

router.get('/sessions/:id/products', async (req, res) => {
  try {
    const sessionId = parseInt(req.params.id);
    const { status, sort } = req.query;
    const products = await store.listProducts(sessionId, {
      status: status as string,
      sort: sort as string,
    });
    res.json(products);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to list products' });
  }
});

router.get('/sessions/:id/products/:code', async (req, res) => {
  try {
    const sessionId = parseInt(req.params.id);
    const code = req.params.code;
    const product = await store.getProduct(sessionId, code);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json(product);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get product' });
  }
});

router.put('/sessions/:id/products/:code', async (req, res) => {
  try {
    const sessionId = parseInt(req.params.id);
    const code = req.params.code;
    const { counted_qty, adjusted_qty, status, notes } = req.body;

    const update: Record<string, unknown> = {};
    if (counted_qty !== undefined) update.counted_qty = counted_qty;
    if (adjusted_qty !== undefined) update.adjusted_qty = adjusted_qty;
    if (status !== undefined) update.status = status;
    if (notes !== undefined) update.notes = notes;

    const product = await store.updateProduct(sessionId, code, update);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    broadcast(sessionId, { type: 'product_updated', product });
    res.json(product);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update product' });
  }
});

router.post('/sessions/:id/scan', async (req, res) => {
  try {
    const sessionId = parseInt(req.params.id);
    const { product_code } = req.body;

    if (!product_code) return res.status(400).json({ error: 'product_code required' });

    const result = await store.scanProduct(sessionId, (product_code as string).trim());
    if (!result) return res.status(404).json({ error: 'Product not found in session' });

    broadcast(sessionId, { type: 'product_scanned', product: result.product, match: result.match });
    res.json({ ...result.product, match: result.match });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to scan product' });
  }
});

router.post('/sessions/:id/import-system', async (req, res) => {
  try {
    const sessionId = parseInt(req.params.id);
    const { products, display_columns } = req.body;
    const replace = req.query.replace === 'true';

    if (!products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ error: 'No products provided' });
    }

    const session = await store.getSession(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    if (!replace && getScannerCountWs(sessionId) > 0) {
      return res.status(409).json({ error: 'Cannot import — another scanner is currently connected.' });
    }

    if (replace) {
      await store.deleteSessionProducts(sessionId);
    }

    if (display_columns && Array.isArray(display_columns)) {
      await store.setDisplayColumns(sessionId, display_columns);
    }

    const count = await store.createProducts(sessionId, products);
    await store.updateSession(sessionId, { status: 'active' } as Partial<store.SessionRow>);

    broadcast(sessionId, { type: 'products_imported', count });
    res.json({ message: `Imported ${count} products`, count, replaced: replace });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to import system data' });
  }
});

router.post('/sessions/:id/import-count', async (req, res) => {
  try {
    const sessionId = parseInt(req.params.id);
    const { products } = req.body;

    if (!products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ error: 'No products provided' });
    }

    const matched = await store.importCount(sessionId, products);
    broadcast(sessionId, { type: 'counts_imported', matched });
    res.json({ message: `Import complete: ${matched} matched` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to import count data' });
  }
});

export default router;
