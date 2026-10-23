const {test,expect}=require('@playwright/test');

test.beforeEach(async ({page}) => {
  page.errors=[];page.externalRequests=[];
  page.on('pageerror',error=>page.errors.push(error.message));
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.hostname==='127.0.0.1')return route.continue();
    page.externalRequests.push(url.href);return route.abort();
  });
});
test.afterEach(async ({page})=>{expect(page.errors).toEqual([]);expect(page.externalRequests).toEqual([]);});

test('intro is een losse pagina zonder sessie, externe diensten of aanpassingen aan de inlogroute',async({page,request})=>{
  await page.setViewportSize({width:1440,height:1050});await page.goto('/intro/');
  await expect(page.getByRole('heading',{level:1})).toContainText('Rust in je planning.');
  await page.evaluate(()=>document.fonts.ready);
  const app=await (await request.get('/')).text();
  expect(app).toContain('id="auth-overlay"');expect(app).not.toContain('intro/intro');
  await expect(page.locator('#site-nav').getByRole('link',{name:'Open de app'})).toHaveAttribute('href','/');
  await expect(page.locator('script[src*="firebase"],script[src*="auth.js"]')).toHaveCount(0);
  expect(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length}))).toEqual({local:0,session:0});
  await expect(page.locator('.feature-grid article')).toHaveCount(6);
  await expect(page.locator('.price-card')).toHaveCount(4);
  await page.screenshot({path:test.info().outputPath('intro-desktop.png'),fullPage:true,animations:'disabled'});
});

test('demonstratie speelt af, pauzeert, eindigt en kan opnieuw of per stap bekeken worden',async({page})=>{
  await page.clock.install();await page.goto('/intro/');
  const demo=page.locator('.demo'),play=page.locator('#demo-play');
  await play.click();await expect(demo).toHaveAttribute('data-playing','true');
  await page.clock.fastForward(4100);await expect(demo).toHaveAttribute('data-step','1');
  await expect(page.locator('.scan-preview')).toBeVisible();
  await expect(page.locator('.date-value')).toHaveText('28 oktober');
  await expect(page.locator('.time-value')).toHaveText('14:00');
  await play.click();await expect(play).toContainText('Speel verder');
  await page.clock.fastForward(10000);await expect(demo).toHaveAttribute('data-step','1');
  await play.click();await page.clock.fastForward(4100);
  await expect(demo).toHaveAttribute('data-step','2');await expect(page.locator('.demo-result')).toBeVisible();
  await expect(page.locator('.demo-result')).toContainText('Boeking 2');
  await page.clock.fastForward(4100);await expect(play).toContainText('Opnieuw afspelen');
  await play.click();await expect(demo).toHaveAttribute('data-step','0');
  await page.locator('[data-demo-step="2"]').click();await expect(demo).toHaveAttribute('data-playing','false');
  await expect(page.locator('[data-demo-step="2"]')).toHaveAttribute('aria-current','step');
  await page.clock.fastForward(10000);await expect(demo).toHaveAttribute('data-step','2');
});

test('mobiel menu, faq en stappen blijven bruikbaar; minder beweging speelt niets automatisch af',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await page.setViewportSize({width:390,height:844});
  await page.goto('/intro/');
  await page.locator('.nav-toggle').click();await expect(page.locator('#site-nav')).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.locator('#site-nav')).toBeHidden();
  await expect(page.locator('.nav-toggle')).toBeFocused();
  for(const width of [320,390,768]){
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    for(const step of [0,1,2]){
      await page.locator('[data-demo-step="'+step+'"]').click();
      await expect(page.locator('.demo')).toHaveAttribute('data-playing','false');
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      if(step===1)expect(await page.locator('.fake-save').evaluate(el=>el.getBoundingClientRect().bottom<=el.closest('.demo-app').getBoundingClientRect().bottom)).toBe(true);
      if(step===2)expect(await page.locator('.result-toast').evaluate(el=>el.getBoundingClientRect().bottom<=el.closest('.demo-app').getBoundingClientRect().bottom)).toBe(true);
    }
    if(width===390){
      await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
      await page.screenshot({path:test.info().outputPath('intro-mobiel.png'),fullPage:true,animations:'disabled'});
    }
  }
  await page.locator('#demo-play').click();await expect(page.locator('.demo')).toHaveAttribute('data-step','0');
  await expect(page.locator('.demo')).toHaveAttribute('data-playing','false');
  await page.locator('.faq summary').nth(1).click();
  await expect(page.locator('.faq details').nth(1)).toHaveAttribute('open','');
  await expect(page.locator('.faq details').nth(1)).toContainText('zelf invoeren');
});
