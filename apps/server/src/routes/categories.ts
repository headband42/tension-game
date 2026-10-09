import { Hono } from 'hono';
import { z } from 'zod';

const categoryRoutes = new Hono();

// Get all categories with hierarchy
categoryRoutes.get('/', async (c) => {
  const prisma = c.get('prisma');
  
  const categories = await prisma.category.findMany({
    orderBy: [{ depth: 'asc' }, { name: 'asc' }],
    include: {
      _count: {
        select: { questions: true },
      },
    },
  });
  
  // Calculate total questions including subcategories
  const categoryMap = new Map();
  
  // First pass: create nodes and store direct counts
  for (const cat of categories) {
    categoryMap.set(cat.id, {
      ...cat,
      directCount: cat._count.questions,
      totalCount: cat._count.questions, // Will aggregate later
      children: [],
    });
  }
  
  // Second pass: build tree and aggregate counts
  const rootCategories = [];
  
  // Process in reverse depth order (deepest first) to aggregate up
  const sortedByDepth = [...categories].sort((a, b) => b.depth - a.depth);
  
  for (const cat of sortedByDepth) {
    const node = categoryMap.get(cat.id);
    
    if (cat.parentId) {
      const parent = categoryMap.get(cat.parentId);
      if (parent) {
        parent.children.push(node);
        // Add this node's total to parent's total
        parent.totalCount += node.totalCount;
      }
    } else {
      rootCategories.push(node);
    }
  }
  
  // Third pass: format response
  const formatNode = (node: any) => ({
    ...node,
    _count: {
      questions: node.totalCount, // Use aggregated total
    },
    children: node.children.map(formatNode),
  });
  
  return c.json({ 
    categories: rootCategories.map(formatNode) 
  });
});

// Get questions for a category (including subcategories)
categoryRoutes.get('/:id/questions', async (c) => {
  const prisma = c.get('prisma');
  const id = c.req.param('id');
  
  const category = await prisma.category.findUnique({
    where: { id },
  });
  
  if (!category) {
    return c.json({ error: 'Category not found' }, 404);
  }
  
  // Get all subcategory IDs using path prefix
  const subcategories = await prisma.category.findMany({
    where: {
      path: {
        startsWith: category.path,
      },
    },
    select: { id: true },
  });
  
  const categoryIds = subcategories.map(c => c.id);
  
  const questions = await prisma.question.findMany({
    where: {
      categoryId: { in: categoryIds },
      active: true,
    },
    include: {
      answers: {
        orderBy: { rank: 'asc' },
      },
      category: true,
    },
  });
  
  return c.json({ questions });
});

// Create a new category
categoryRoutes.post('/', async (c) => {
  const prisma = c.get('prisma');
  const body = await c.req.json();
  
  const schema = z.object({
    id: z.string(),
    name: z.string(),
    parentId: z.string().optional(),
  });
  
  const result = schema.safeParse(body);
  if (!result.success) {
    return c.json({ error: 'Invalid input' }, 400);
  }
  
  let depth = 0;
  let path = result.data.id;
  
  if (result.data.parentId) {
    const parent = await prisma.category.findUnique({
      where: { id: result.data.parentId },
    });
    if (parent) {
      depth = parent.depth + 1;
      path = `${parent.path}/${result.data.id}`;
    }
  }
  
  const category = await prisma.category.create({
    data: {
      id: result.data.id,
      name: result.data.name,
      parentId: result.data.parentId,
      depth,
      path,
    },
  });
  
  return c.json({ category }, 201);
});

export { categoryRoutes };
