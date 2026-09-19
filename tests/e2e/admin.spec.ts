import { expect, test } from '@playwright/test';

test('el administrador inicia sesión y consulta el resumen', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/admin/');
  await page.getByLabel('Correo').fill(process.env.ADMIN_EMAIL ?? '');
  await page.getByLabel('Contraseña').fill(process.env.ADMIN_PASSWORD ?? '');
  await page.getByRole('button', { name: 'Entrar' }).click();

  await expect(page.getByRole('heading', { name: 'Resumen' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Menú' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dispositivos' })).toBeVisible();
});
