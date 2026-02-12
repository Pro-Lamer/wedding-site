import React, { useMemo, useState } from 'react';
import { request } from './api';

const defaultPost = {
  type: 'request',
  title: '',
  description: '',
  regionCode: '',
  budgetMin: '',
  budgetMax: ''
};

export function App() {
  const [token, setToken] = useState('');
  const [email, setEmail] = useState('admin@example.com');
  const [password, setPassword] = useState('password123');
  const [inn, setInn] = useState('7707083893');
  const [company, setCompany] = useState(null);
  const [posts, setPosts] = useState([]);
  const [myResponses, setMyResponses] = useState([]);
  const [postForm, setPostForm] = useState(defaultPost);
  const [status, setStatus] = useState('Готово');

  const loggedIn = useMemo(() => Boolean(token), [token]);

  async function register() {
    try {
      const data = await request('/auth/register', {
        method: 'POST',
        body: { email, password, inn }
      });
      setToken(data.accessToken);
      setStatus('Регистрация выполнена');
    } catch (e) {
      setStatus(`Ошибка: ${e.message}`);
    }
  }

  async function login() {
    try {
      const data = await request('/auth/login', {
        method: 'POST',
        body: { email, password }
      });
      setToken(data.accessToken);
      setStatus('Вход выполнен');
    } catch (e) {
      setStatus(`Ошибка: ${e.message}`);
    }
  }

  async function loadCompany() {
    try {
      const data = await request('/companies/me', { token });
      setCompany(data);
      setStatus('Профиль компании загружен');
    } catch (e) {
      setStatus(`Ошибка: ${e.message}`);
    }
  }

  async function loadPosts() {
    try {
      const data = await request('/posts', { token });
      setPosts(data.items || []);
      setStatus('Посты загружены');
    } catch (e) {
      setStatus(`Ошибка: ${e.message}`);
    }
  }

  async function createPost(e) {
    e.preventDefault();
    try {
      await request('/posts', {
        method: 'POST',
        token,
        body: {
          ...postForm,
          budgetMin: postForm.budgetMin ? Number(postForm.budgetMin) : null,
          budgetMax: postForm.budgetMax ? Number(postForm.budgetMax) : null,
          categoryId: null,
          remoteFlag: false,
          deadlineDate: null
        }
      });
      setPostForm(defaultPost);
      setStatus('Пост создан');
      loadPosts();
    } catch (e2) {
      setStatus(`Ошибка: ${e2.message}`);
    }
  }

  async function createTestResponse(postId) {
    try {
      await request(`/posts/${postId}/responses`, {
        method: 'POST',
        token,
        body: { message: 'Тестовый отклик', price: 10000, timelineDays: 7 }
      });
      setStatus('Отклик отправлен');
    } catch (e) {
      setStatus(`Ошибка: ${e.message}`);
    }
  }

  async function loadMyResponses() {
    try {
      const data = await request('/my/responses', { token });
      setMyResponses(data.items || []);
      setStatus('Мои отклики загружены');
    } catch (e) {
      setStatus(`Ошибка: ${e.message}`);
    }
  }

  return (
    <div className="page">
      <header>
        <h1>Wedding B2B MVP</h1>
        <p>Демо-интерфейс для запуска и проверки ключевых сценариев.</p>
      </header>

      <section className="card">
        <h2>1) Авторизация</h2>
        <div className="grid">
          <label>Email<input value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label>Пароль<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <label>ИНН<input value={inn} onChange={(e) => setInn(e.target.value)} /></label>
        </div>
        <div className="row">
          <button onClick={register}>Регистрация</button>
          <button onClick={login}>Вход</button>
        </div>
      </section>

      {loggedIn && (
        <>
          <section className="card">
            <h2>2) Компания</h2>
            <div className="row">
              <button onClick={loadCompany}>Загрузить мой профиль</button>
            </div>
            {company && <pre>{JSON.stringify(company, null, 2)}</pre>}
          </section>

          <section className="card">
            <h2>3) Посты</h2>
            <form onSubmit={createPost} className="grid">
              <label>
                Тип
                <select value={postForm.type} onChange={(e) => setPostForm((p) => ({ ...p, type: e.target.value }))}>
                  <option value="request">Заявка</option>
                  <option value="offer">Предложение</option>
                </select>
              </label>
              <label>Заголовок<input value={postForm.title} onChange={(e) => setPostForm((p) => ({ ...p, title: e.target.value }))} /></label>
              <label>Описание<textarea value={postForm.description} onChange={(e) => setPostForm((p) => ({ ...p, description: e.target.value }))} /></label>
              <label>Регион<input value={postForm.regionCode} onChange={(e) => setPostForm((p) => ({ ...p, regionCode: e.target.value }))} /></label>
              <label>Бюджет от<input value={postForm.budgetMin} onChange={(e) => setPostForm((p) => ({ ...p, budgetMin: e.target.value }))} /></label>
              <label>Бюджет до<input value={postForm.budgetMax} onChange={(e) => setPostForm((p) => ({ ...p, budgetMax: e.target.value }))} /></label>
              <button type="submit">Создать пост</button>
            </form>
            <div className="row">
              <button onClick={loadPosts}>Обновить список постов</button>
            </div>
            <ul>
              {posts.map((p) => (
                <li key={p.id}>
                  <strong>{p.title}</strong> ({p.type}) — {p.company_name || p.company_id}
                  <button onClick={() => createTestResponse(p.id)}>Отправить тестовый отклик</button>
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <h2>4) Отклики</h2>
            <button onClick={loadMyResponses}>Показать мои отклики</button>
            <ul>
              {myResponses.map((r) => (
                <li key={r.id}>{r.post_title}: {r.message}</li>
              ))}
            </ul>
          </section>
        </>
      )}

      <footer className="status">Статус: {status}</footer>
    </div>
  );
}
