FROM nginx:alpine

# Устанавливаем рабочую директорию (необязательно, но удобно)
WORKDIR /usr/share/nginx/html

# Копируем всё содержимое текущей папки (где лежит Dockerfile) в /usr/share/nginx/html
COPY . .

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]