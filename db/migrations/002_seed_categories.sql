INSERT INTO categories (name)
SELECT v.name
FROM (VALUES
  ('Флористика'),
  ('Декор'),
  ('Кейтеринг'),
  ('Фото/Видео'),
  ('Площадка'),
  ('Транспорт')
) AS v(name)
WHERE NOT EXISTS (SELECT 1 FROM categories c WHERE c.name = v.name);
