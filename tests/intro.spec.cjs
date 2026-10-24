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

test('hoofdadres toont de intro zonder sessie of externe diensten, app heeft een rechtstreekse ingang',async({page,request})=>{
  await page.setViewportSize({width:1440,height:1050});await page.goto('/');
  await expect(page.getByRole('heading',{level:1})).toContainText('Rust in je planning.');
  await page.evaluate(()=>document.fonts.ready);
  const app=await (await request.get('/app/')).text();
  expect(app).toContain('id="auth-overlay"');expect(app).not.toContain('intro/intro');
  await expect(page.locator('#site-nav').getByRole('link',{name:'Open de app'})).toHaveAttribute('href','/app/');
  await expect(page.getByRole('link',{name:'Hoe zet ik de app op mijn beginscherm?'})).toHaveAttribute('href','/app/#installeren');
  await expect(page.locator('script[src*="firebase"],script[src*="auth.js"]')).toHaveCount(0);
  expect(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length}))).toEqual({local:0,session:0});
  await expect(page.locator('.feature-grid article')).toHaveCount(6);
  await expect(page.locator('.price-card')).toHaveCount(4);
  const invitation=new URL(await page.locator('.invitation-contact').getAttribute('href'));
  expect(invitation.origin).toBe('https://wa.me');
  expect(invitation.pathname).toBe('/31682272729');
  expect(invitation.searchParams.get('text')).toContain('uitnodigingscode aanvragen');
  await expect(page.locator('.price-card a[href="#uitnodiging"]')).toHaveCount(4);
  await page.screenshot({path:test.info().outputPath('intro-desktop.png'),fullPage:true,animations:'disabled'});
});

test('bestaande betaal-, melding- en introductielinks blijven naar de juiste ingang leiden',async({page})=>{
  // Inspect destinations only; never load the app's remote authentication SDKs.
  await page.route('**/app/**',route=>route.fulfill({contentType:'text/html',body:'<h1>App-ingang</h1>'}));
  for(const query of ['?betaling=geslaagd','?betaling=geannuleerd','?goto=nieuws']){
    await page.goto('/'+query+'#test');
    await expect(page).toHaveURL(new RegExp('/app/'+query.replace(/[?]/g,'\\?')+'#test$'));
  }
  await page.goto('/intro/');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading',{level:1})).toContainText('Rust in je planning.');
  await page.addInitScript(()=>Object.defineProperty(navigator,'standalone',{value:true,configurable:true}));
  await page.goto('/');
  await expect(page).toHaveURL(/\/app\/$/);
  await page.goto('/#introductie');
  await expect(page.getByRole('heading',{level:1})).toContainText('Rust in je planning.');
  await expect(page).toHaveURL(/\/#introductie$/);
});

test('demonstratie start bij scrollen, herhaalt en pauzeert buiten beeld',async({page})=>{
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.clock.install();await page.goto('/');
  const demo=page.locator('.demo'),stage=page.locator('.demo-stage');
  await expect(demo).toHaveAttribute('data-playing','false');
  await expect(demo.locator('button')).toHaveCount(0);
  await stage.scrollIntoViewIfNeeded();await expect(demo).toHaveAttribute('data-playing','true');
  await page.clock.fastForward(4100);await expect(demo).toHaveAttribute('data-step','1');
  await expect(page.locator('.scan-preview')).toBeVisible();
  await expect(page.locator('.date-value')).toHaveText('28 oktober');
  await expect(page.locator('.time-value')).toHaveText('14:00');
  await page.clock.fastForward(4100);await expect(demo).toHaveAttribute('data-step','2');
  await expect(page.locator('.demo-result')).toBeVisible();
  await page.clock.fastForward(4100);await expect(demo).toHaveAttribute('data-step','0');
  await expect(demo).toHaveAttribute('data-playing','true');
  await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
  await expect(demo).toHaveAttribute('data-playing','false');
  const stopped=await demo.getAttribute('data-step');
  await page.clock.fastForward(20000);await expect(demo).toHaveAttribute('data-step',stopped);
  await stage.scrollIntoViewIfNeeded();await expect(demo).toHaveAttribute('data-playing','true');
  await page.clock.fastForward(4100);await expect(demo).toHaveAttribute('data-step','1');
});

test('mobiel toont drie concurrenten en een passende dagplanning; minder beweging toont de hele uitleg stil',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await page.locator('.nav-toggle').click();await expect(page.locator('#site-nav')).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.locator('#site-nav')).toBeHidden();
  await expect(page.locator('.nav-toggle')).toBeFocused();
  await expect(page.locator('.ranking-preview-row')).toHaveCount(3);
  await expect(page.locator('.unpaid-booking')).toContainText('Achteraf');
  await expect(page.locator('.schedule-booking')).toHaveCount(3);
  await expect(page.locator('.schedule-booking').nth(1)).toContainText('Emma');
  await expect(page.locator('.schedule-gap').nth(0)).toContainText('12:25');
  await expect(page.locator('.schedule-gap').nth(1)).toContainText('15:35');
  for(const width of [320,390,768]){
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.locator('.demo-stage').scrollIntoViewIfNeeded();
    await expect(page.locator('.demo')).toHaveAttribute('data-playing','false');
    await expect(page.locator('.demo-form')).toBeVisible();
    await expect(page.locator('.demo-result')).toBeVisible();
    expect(await page.locator('.result-toast').evaluate(el=>el.getBoundingClientRect().bottom<=el.closest('.demo-app').getBoundingClientRect().bottom)).toBe(true);
    if(width===390){
      await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
      await page.screenshot({path:test.info().outputPath('intro-mobiel.png'),fullPage:true,animations:'disabled'});
    }
  }
  await page.locator('.faq summary').nth(1).click();
  await expect(page.locator('.faq details').nth(1)).toHaveAttribute('open','');
  await expect(page.locator('.faq details').nth(1)).toContainText('zelf invoeren');
});
