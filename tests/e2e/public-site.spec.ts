import { expect, test } from '@playwright/test';

test('la portada comunica la propuesta y lleva al menú', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Más que burgers');
  await expect(page.getByRole('link', { name: 'Ver el menú' })).toBeVisible();
  await expect(page.getByText('Entrega gratis', { exact: true })).toBeVisible();
});

test('un cliente personaliza un producto y arma el pedido', async ({ page }) => {
  await page.goto('/menu');
  await expect(page.locator('.menu-app')).toHaveAttribute('data-hydrated', 'true');
  const product = page.locator('#clasica');
  await expect(product.getByRole('heading', { name: 'Clásica' })).toBeVisible();
  await product.getByRole('button', { name: 'Personalizar' }).click();
  const dialog = page.getByRole('dialog', { name: 'Clásica' });
  await dialog.getByText('Sin Cebolla').click();
  await dialog.getByText('Combo +$46').click();
  await dialog.getByRole('button', { name: /Agregar/ }).click();
  const cart = page.getByRole('dialog', { name: 'Tu pedido' });
  await expect(cart.getByText('Clásica')).toBeVisible();
  await expect(cart.getByText(/Combo/)).toBeVisible();
  await cart.getByLabel('Nombre').fill('Cliente de prueba');
  await cart.getByLabel('Colonia').fill('Canarios');
  await cart.getByLabel('Calle y número').fill('Calle 1, número 2');
  await expect(cart.getByRole('button', { name: 'Enviar pedido por WhatsApp' })).toBeEnabled();
});

test('la ruleta solo muestra el resultado que devuelve la API', async ({ page }) => {
  await page.route('**/api/v1/spins/redeem', async (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        redemptionId: '5e14e18e-0089-4f34-8938-826b7280784b',
        prize: { id: 'descuento-10', label: '10% de descuento', emoji: '🏷️' },
        remainingSpins: 0,
        targetSegment: 0,
        mode: 'redeem',
        verificationPath: '/api/v1/spins/results/5e14e18e-0089-4f34-8938-826b7280784b',
      }),
    }),
  );
  await page.goto('/ruleta');
  await expect(page.locator('.roulette-app')).toHaveAttribute('data-hydrated', 'true');
  await page.getByLabel('Código').fill('BJ-1234');
  await page.getByRole('button', { name: 'Girar ruleta' }).click();
  await expect(page.getByRole('dialog')).toContainText('10% de descuento');
  await expect(page.getByRole('status')).toContainText('0 giro');
});

test('la tirada de prueba queda marcada y verificable como no canjeable', async ({ page }) => {
  await page.route('**/api/v1/spins/demo', async (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        redemptionId: '3f1a052d-34c4-4be3-bcad-3125f6cf7c31',
        prize: { id: 'descuento-20', label: '20% de descuento', emoji: '🎉' },
        remainingSpins: 0,
        targetSegment: 9,
        mode: 'demo',
        verificationPath: '/api/v1/spins/results/3f1a052d-34c4-4be3-bcad-3125f6cf7c31',
      }),
    }),
  );
  await page.goto('/ruleta');
  await expect(page.locator('.roulette-app')).toHaveAttribute('data-hydrated', 'true');
  await page.getByRole('button', { name: 'Probar sin código' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('PRUEBA · NO CANJEABLE');
  await expect(dialog).toContainText('prueba sin valor');
  await expect(dialog.getByRole('link', { name: 'Verificar en servidor' })).toBeVisible();
});
