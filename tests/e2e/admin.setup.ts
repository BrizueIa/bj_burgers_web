import { mkdir } from 'node:fs/promises';
import { expect, test as setup } from '@playwright/test';

const authFile = 'playwright/.auth/admin.json';

setup('inicia sesión de administración', async ({ page }) => {
  await mkdir('playwright/.auth', { recursive: true });
  await page.goto('http://127.0.0.1:5173/admin/');
  await page.getByLabel('Correo').fill(process.env.ADMIN_EMAIL ?? '');
  await page.getByLabel('Contraseña').fill(process.env.ADMIN_PASSWORD ?? '');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Resumen' })).toBeVisible();
  await page.context().storageState({ path: authFile });
});
