FROM nginx:alpine

RUN rm -rf /usr/share/nginx/html/* \
    && rm -f /etc/nginx/conf.d/default.conf

COPY *.html /usr/share/nginx/html/
COPY perfume.jpg /usr/share/nginx/html/perfume.jpg
COPY css /usr/share/nginx/html/css
COPY js /usr/share/nginx/html/js
COPY img/buva /usr/share/nginx/html/img/buva
COPY default.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
