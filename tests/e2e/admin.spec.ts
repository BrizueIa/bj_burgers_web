import { expect, test } from '@playwright/test';

test('el administrador inicia sesión y consulta el resumen', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/admin/');
  await expect(page.getByRole('heading', { name: 'Resumen' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Menú' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dispositivos' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Vender' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Caja' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reportes' })).toBeVisible();
});

test('la administración presenta POS, caja y reportes desde el mismo panel', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/admin/');
  await expect(page.getByRole('heading', { name: 'Resumen' })).toBeVisible();
  await page.getByRole('button', { name: 'Vender' }).click();
  await expect(page.getByRole('heading', { name: 'Nueva venta' })).toBeVisible();
  await expect(page.getByLabel('Producto')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Agregar' })).toBeVisible();
  await page.getByRole('button', { name: 'Caja' }).click();
  await expect(page.getByRole('heading', { name: 'Caja cerrada' })).toBeVisible();
  await page.getByRole('button', { name: 'Reportes' }).click();
  await expect(page.getByRole('heading', { name: 'Periodo del reporte' })).toBeVisible();
});
