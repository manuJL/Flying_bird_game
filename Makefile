BACKEND_PORT ?= 8000
FRONTEND_PORT ?= 5000

install-backend:
	python3 -m venv backend/.venv
	backend/.venv/bin/pip install -q -r backend/requirements.txt

install-frontend:
	cd frontend && npm install

run-backend:
	cd backend && .venv/bin/uvicorn main:app --host 0.0.0.0 --port $(BACKEND_PORT)

run-frontend:
	$(if $(BASE_BE_ENDPOINT),,$(error BASE_BE_ENDPOINT is not set))
	cd frontend && VITE_BASE_BE_ENDPOINT=$(BASE_BE_ENDPOINT) npm run dev -- --host 0.0.0.0 --port $(FRONTEND_PORT)

db-setup:
	python3 -m venv .seeder_venv
	.seeder_venv/bin/pip install -q faker==30.8.2 bcrypt==4.2.1
	.seeder_venv/bin/python .challenge_metadata/seed.py
	@rm -rf .seeder_venv

.PHONY: install-backend install-frontend run-backend run-frontend db-setup