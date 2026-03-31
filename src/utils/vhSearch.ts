import fs from 'fs/promises';
import path from 'path';
import * as cheerio from 'cheerio';

export default async (posts: any[]) => {
  const searchIndex = posts.map(i => {
    const $ = cheerio.load(`<body>${i.rendered.html}</body>`);
    return {
      title: i.data.title,
      url: `/article/${i.data.id}`,
      content: `${i.data.title} - ` + $('body').text().replace(/\n/g, '').replace(/<[^>]+>/g, '')
    };
  });

  try {
    const json = JSON.stringify(searchIndex);
    const distDir = path.join(process.cwd(), 'dist');
    const publicDir = path.join(process.cwd(), 'public');

    await Promise.all([
      fs.mkdir(distDir, { recursive: true }),
      fs.mkdir(publicDir, { recursive: true })
    ]);

    await Promise.all([
      fs.writeFile(path.join(distDir, 'vh-search.json'), json),
      fs.writeFile(path.join(publicDir, 'vh-search.json'), json)
    ]);

    console.log('\x1b[32m%s\x1b[0m', '搜索文件vh-search文件已生成 successfully');
  } catch (error) {
    console.error('Error writing search index file:', error);
  }
};
